// The following originally comes from a gist available here:
// https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

'use strict';

const http = require('http');
const EventEmitter = require('events');

module.exports = function(opts) {
  opts = initOptions(opts);

  optionMustBeFunction(opts.readiness.checker, 'readiness.checker');
  optionMustBeFunction(opts.liveness.checker, 'liveness.checker');

  optionMustBeFunction(opts.readiness.createChecker, 'readiness.createChecker');
  optionMustBeFunction(opts.liveness.createChecker, 'liveness.createChecker');

  let state = 'down';
  let server;
  const probeMap = {};

  function handler(req, res) {
    const probe = probeMap[req.url];
    if (!probe) {
      writeResponse(res, state, 404, 'Not found');
    } else {
      const timeout = setTimeout(function () {
        writeResponse(res, state, 503, 'Request timeout');
      }, probe.timeoutMs);

      probe.checker(function (errorMessage) {
        clearTimeout(timeout);
        writeResponse(res, state, (typeof errorMessage === 'undefined' && state != 'down') ? 200 : 503, errorMessage);
      });
    }
  }

  return {
    created(broker) {
      broker.healthcheck = new EventEmitter();
      state = 'starting';

      server = http.createServer(handler);
      server.listen(opts.port, err => {
        if (err) {
          return broker.logger.error('Unable to start health-check server', err);
        }

        // listening port is chosen by NodeJS if opts.port === 0
        broker.healthcheck.port = server.address().port;
        broker.healthcheck.emit('port', broker.healthcheck.port);

        logStartMessage(broker.logger, broker.healthcheck.port, opts.readiness.path, opts.liveness.path);
      });
    },

    // After broker started
    started(broker) {
      state = 'up';
      [opts.readiness, opts.liveness].forEach((probe) => initProbeMap(probeMap, probe, broker));
    },

    // Before broker stopping
    stopping(broker) {
      state = 'stopping';
    },

    // After broker stopped
    stopped(broker) {
      state = 'down';
      server.close();
    }
  };
};

function defaultIfUndefined (value, defaultValue) {
  return typeof value === 'undefined' ? defaultValue : value;
};

function initOptions(opts) {
  opts = defaultIfUndefined(opts, {});
  opts.port = defaultIfUndefined(opts.port, 3001);
  opts.readiness = defaultIfUndefined(opts.readiness, {});
  opts.liveness = defaultIfUndefined(opts.liveness, {});
  opts.readiness.path = defaultIfUndefined(opts.readiness.path, '/ready');
  opts.readiness.createChecker = defaultIfUndefined(opts.readiness.createChecker, function () { return opts.readiness.checker; });
  opts.readiness.checker = defaultIfUndefined(opts.readiness.checker, function (next) { return next(); });
  opts.readiness.checkerTimeoutMs = defaultIfUndefined(opts.readiness.checkerTimeoutMs, 20000);
  opts.liveness.path = defaultIfUndefined(opts.liveness.path, '/live');
  opts.liveness.createChecker = defaultIfUndefined(opts.liveness.createChecker, function () { return opts.liveness.checker; });
  opts.liveness.checker = defaultIfUndefined(opts.liveness.checker, function (next) { return next(); });
  opts.liveness.checkerTimeoutMs = defaultIfUndefined(opts.liveness.checkerTimeoutMs, 20000);
  return opts;
};

function initProbeMap(probeMap, probe, broker) {
  probe.checker = probe.createChecker(broker);
  probeMap[probe.path] = probe;
};

function optionMustBeFunction(option, optionName) {
  if (typeof option !== 'function') {
    throw new Error(`option ${optionName} is not a function`);
  }
};

function writeResponse(res, state, code, errorMessage) {
  const resHeader = {
    'Content-Type': 'application/json; charset=utf-8'
  };
  res.writeHead(code, resHeader);
  const content = buildResponseContent(state, code, errorMessage);
  res.end(JSON.stringify(content, null, 2));
};

function buildResponseContent(state, code, errorMessage) {
  if(code == 200) {
    return {
      state,
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  } else {
    return errorMessage;
  }
};

function logStartMessage(logger, port, readinessPath, livenessPath) {
  logger.info('');
  logger.info('K8s health-check server listening on');
  logger.info(`    http://localhost:${port}${readinessPath}`);
  logger.info(`    http://localhost:${port}${livenessPath}`);
  logger.info('');
};
