// The following originally comes from a gist available here:
// https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

import http from 'node:http';
import EventEmitter from 'node:events';

export default (options) => {
  options = initOptions(options);

  optionMustBeFunction(options.readiness.checker, 'readiness.checker');
  optionMustBeFunction(options.liveness.checker, 'liveness.checker');

  optionMustBeFunction(options.readiness.createChecker, 'readiness.createChecker');
  optionMustBeFunction(options.liveness.createChecker, 'liveness.createChecker');

  let state = 'down';
  let server;
  const probeMap = {};

  const handler = (logger) =>
    function (request, response) {
      const probe = probeMap[request.url];
      if (probe) {
        let timeout = setTimeout(() => {
          logger.warn(`${request.url} checker did not reply in time`);
          writeResponse({ response, state, code: 503, errorMessage: 'Request timeout' });
          timeout = undefined;
        }, probe.checkerTimeoutMs);

        probe.checker((errorMessage) => {
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
            writeResponse({
              response,
              state,
              code: errorMessage === undefined && state != 'down' ? 200 : 503,
              errorMessage,
            });
          } else {
            logger.warn(`${request.url} checker is spamming the callback`);
          }
        });
      } else {
        writeResponse({ response, state, code: 404, errorMessage: 'Not found' });
      }
    };

  return {
    created(broker) {
      const logger = broker.getLogger('moleculer-healthcheck-middleware');
      // eslint-disable-next-line unicorn/prefer-event-target
      broker.healthcheck = new EventEmitter();
      state = 'starting';

      server = http.createServer(handler(logger));

      server.listen(options.port, () => {
        // listening port is chosen by NodeJS if opts.port === 0
        broker.healthcheck.port = server.address().port;
        broker.healthcheck.emit('port', broker.healthcheck.port);

        logStartMessage({
          logger,
          port: broker.healthcheck.port,
          readinessPath: options.readiness.path,
          livenessPath: options.liveness.path,
        });
      });
    },

    // After broker started
    started(broker) {
      state = 'up';
      for (const probe of [options.readiness, options.liveness]) initProbeMap(probeMap, probe, broker);
    },

    // Before broker stopping
    stopping() {
      state = 'stopping';
    },

    // After broker stopped
    stopped() {
      state = 'down';
      server.close();
    },
  };
};

const defaultIfUndefined = (value, defaultValue) => {
  return value === undefined ? defaultValue : value;
};

const initOptions = (options) => {
  options = defaultIfUndefined(options, {});
  options.port = defaultIfUndefined(options.port, 3001);
  options.readiness = defaultIfUndefined(options.readiness, {});
  options.liveness = defaultIfUndefined(options.liveness, {});
  options.readiness.path = defaultIfUndefined(options.readiness.path, '/ready');
  options.readiness.createChecker = defaultIfUndefined(options.readiness.createChecker, function () {
    return options.readiness.checker;
  });
  options.readiness.checker = defaultIfUndefined(options.readiness.checker, function (next) {
    return next();
  });
  options.readiness.checkerTimeoutMs = defaultIfUndefined(options.readiness.checkerTimeoutMs, 20_000);
  options.liveness.path = defaultIfUndefined(options.liveness.path, '/live');
  options.liveness.createChecker = defaultIfUndefined(options.liveness.createChecker, function () {
    return options.liveness.checker;
  });
  options.liveness.checker = defaultIfUndefined(options.liveness.checker, function (next) {
    return next();
  });
  options.liveness.checkerTimeoutMs = defaultIfUndefined(options.liveness.checkerTimeoutMs, 20_000);
  return options;
};

const initProbeMap = (probeMap, probe, broker) => {
  probe.checker = probe.createChecker(broker);
  probeMap[probe.path] = probe;
};

const optionMustBeFunction = (option, optionName) => {
  if (typeof option !== 'function') {
    throw new TypeError(`option ${optionName} is not a function`);
  }
};

const writeResponse = ({ response, state, code, errorMessage }) => {
  const responseHeader = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  response.writeHead(code, responseHeader);
  const content = buildResponseContent(state, code, errorMessage);
  response.end(JSON.stringify(content, undefined, 2));
};

const buildResponseContent = (state, code, errorMessage) => {
  return code == 200
    ? {
        state,
        uptime: process.uptime(),
        timestamp: Date.now(),
      }
    : errorMessage;
};

const logStartMessage = ({ logger, port, readinessPath, livenessPath }) => {
  logger.info(`K8S readiness URL: http://localhost:${port}${readinessPath}`);
  logger.info(`K8S liveness URL: http://localhost:${port}${livenessPath}`);
};
