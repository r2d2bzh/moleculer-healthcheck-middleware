// The following originally comes from a gist available here:
// https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

'use strict';

const http = require('http');
const EventEmitter = require('events');

module.exports = function(opts) {
	initOptions(opts);

	optionMustBeFunction(opts.readiness.checker, 'readiness.checker');
	optionMustBeFunction(opts.liveness.checker, 'liveness.checker');

	optionMustBeFunction(opts.readiness.createChecker, 'readiness.createChecker');
	optionMustBeFunction(opts.liveness.createChecker, 'liveness.createChecker');

	let state = 'down';
	let server;
	const checkersInfo = {};

	function handler(req, res) {
		if (req.url == opts.readiness.path || req.url == opts.liveness.path) {
			const checkerInfo = checkersInfo[req.url];

			const timeout = setTimeout(function () {
				writeResponse(res, state, 503);
			}, checkerInfo.timeoutMs);

			checkerInfo.checker(function (errorMessage) {
				clearTimeout(timeout);
				writeResponse(res, state, (typeof errorMessage === 'undefined' && state != 'down') ? 200 : 503);
			});
		} else {
			writeResponse(res, state, 404);
		}
	}

	return {
		created(broker) {
			broker.healthcheck = new EventEmitter();
			state = 'starting';

			server = http.createServer(handler);
			server.on('request', handler);
			server.listen(opts.port, err => {
				if (err) {
					return broker.logger.error('Unable to start health-check server', err);
				}

				// listening port is chosen by NodeJS if opts.port === 0
				broker.healthcheck.port = server.address().port;
				broker.healthcheck.emit('port', broker.healthcheck.port);

				broker.logger.info('');
				broker.logger.info('K8s health-check server listening on');
				broker.logger.info(`    http://localhost:${broker.healthcheck.port}${opts.readiness.path}`);
				broker.logger.info(`    http://localhost:${broker.healthcheck.port}${opts.liveness.path}`);
				broker.logger.info('');
			});
		},

		// After broker started
		started(broker) {
			state = 'up';

			initChecker(checkersInfo, opts.readiness.path, opts.readiness.createChecker(broker), opts.readiness.timeoutMs);
			initChecker(checkersInfo, opts.liveness.path, opts.liveness.createChecker(broker), opts.liveness.timeoutMs);
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
};

function initChecker(checkersInfo, servicePath, checker, timeoutMs) {
	checkersInfo[servicePath] = {
		checker,
		timeoutMs
	};
};

function optionMustBeFunction(option, optionName) {
	if (typeof option !== 'function') {
		throw new Error(`option ${optionName} is not a function`);
	}
};

function writeResponse(res, state, code) {
	const resHeader = {
		'Content-Type': 'application/json; charset=utf-8'
	};
	const content = {
		state,
		uptime: process.uptime(),
		timestamp: Date.now()
	};
	res.writeHead(code, resHeader);
	res.end(JSON.stringify(content, null, 2));
};