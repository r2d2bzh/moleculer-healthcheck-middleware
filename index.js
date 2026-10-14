// The following originally comes from a gist available here:
// https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

import http from 'node:http';
import EventEmitter from 'node:events';

/**
@callback CheckerCallback
@param {unknown} [errorMessage] Any value other than `undefined` fails the check
@returns {void}
*/

/**
@callback Checker
@param {CheckerCallback} next
@returns {void}
*/

/**
@typedef {object} ProbeOptions
@property {string} [path]
@property {Checker} [checker]
@property {(broker: any) => Checker} [createChecker] Called when the broker is started
@property {number} [checkerTimeoutMs]
*/

/**
@typedef {object} HealthCheckOptions
@property {number} [port] `0` lets the system choose a free port
@property {ProbeOptions} [readiness]
@property {ProbeOptions} [liveness]
*/

/**
@typedef {object} HealthCheckMiddleware
@property {(broker: any) => void} created
@property {(broker: any) => void} started
@property {() => void} stopping
@property {() => void} stopped
*/

/**
@param {HealthCheckOptions} [options]
@returns {HealthCheckMiddleware}
*/
export default (options = {}) => {
  const { port, readiness, liveness } = initOptions(options);

  let state = 'down';
  let server;
  const checkers = new Map();

  const handler = (logger) => (request, response) => {
    const probe = [readiness, liveness].find(({ path }) => path === request.url);
    if (!probe) {
      writeResponse({ response, state, code: 404, errorMessage: 'Not found' });
      return;
    }

    // Probes only succeed while the broker is up, as documented
    const checker = checkers.get(probe);
    if (state !== 'up' || !checker) {
      writeResponse({ response, state, code: 503, errorMessage: `Broker is ${state}` });
      return;
    }

    let timeout = setTimeout(() => {
      logger.warn(`${request.url} checker did not reply in time`);
      writeResponse({ response, state, code: 503, errorMessage: 'Request timeout' });
      timeout = undefined;
    }, probe.checkerTimeoutMs);

    checker((errorMessage) => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
        writeResponse({ response, state, code: errorMessage === undefined ? 200 : 503, errorMessage });
      } else {
        logger.warn(`${request.url} checker replied after the timeout or more than once`);
      }
    });
  };

  return {
    created(broker) {
      const logger = broker.getLogger('moleculer-healthcheck-middleware');
      // eslint-disable-next-line unicorn/prefer-event-target
      broker.healthcheck = new EventEmitter();
      state = 'starting';

      server = http.createServer(handler(logger));

      server.listen(port, () => {
        // listening port is chosen by NodeJS if port === 0
        broker.healthcheck.port = server.address().port;
        broker.healthcheck.emit('port', broker.healthcheck.port);

        logStartMessage({
          logger,
          port: broker.healthcheck.port,
          readinessPath: readiness.path,
          livenessPath: liveness.path,
        });
      });
    },

    // After broker started
    started(broker) {
      for (const probe of [readiness, liveness]) {
        const checker = probe.createChecker(broker);
        optionMustBeFunction(checker, `${probe.name}.createChecker() result`);
        checkers.set(probe, checker);
      }
      state = 'up';
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

const initProbe = ({ name, probe = {}, defaultPath }) => {
  const checker = probe.checker ?? ((next) => next());
  const createChecker = probe.createChecker ?? (() => checker);
  optionMustBeFunction(checker, `${name}.checker`);
  optionMustBeFunction(createChecker, `${name}.createChecker`);
  return {
    name,
    path: probe.path ?? defaultPath,
    createChecker,
    checkerTimeoutMs: probe.checkerTimeoutMs ?? 20_000,
  };
};

// A new object is built so that the options given by the caller are left untouched
const initOptions = ({ port = 3001, readiness, liveness }) => ({
  port,
  readiness: initProbe({ name: 'readiness', probe: readiness, defaultPath: '/ready' }),
  liveness: initProbe({ name: 'liveness', probe: liveness, defaultPath: '/live' }),
});

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
  return code === 200
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
