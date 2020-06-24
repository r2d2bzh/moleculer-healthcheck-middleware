// The following originally comes from a gist available here:
// https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

'use strict';

const http = require('http');
const EventEmitter = require('events');

const dflt = function(current, ifUndefined) {
	return typeof current === 'undefined' ? ifUndefined : current;
};

module.exports = function(opts) {
	opts = dflt(opts, {});
	opts.port = dflt(opts.port, 3001);
	opts.readiness = dflt(opts.readiness, {});
	opts.liveness = dflt(opts.liveness, {});
	opts.readiness.path = dflt(opts.readiness.path, '/ready');
	opts.readiness.checker = dflt(opts.readiness.checker, function (next) { return next(); });
	opts.readiness.checkerTimeoutMs = dflt(opts.readiness.checkerTimeoutMs, 20000);
	opts.liveness.path = dflt(opts.liveness.path, '/live');
	opts.liveness.checker = dflt(opts.liveness.checker, function (next) { return next(); });
	opts.liveness.checkerTimeoutMs = dflt(opts.liveness.checkerTimeoutMs, 20000);

	if (typeof opts.liveness.checker !== 'function' || typeof opts.readiness.checker !== 'function') {
		throw new Error('Can not create middleware checker option must be a function');
	}

	let state = 'down';
	let server;

	function handler(req, res) {
		if (req.url == opts.readiness.path || req.url == opts.liveness.path) {
			const resHeader = {
				'Content-Type': 'application/json; charset=utf-8'
			};

			const content = {
				state,
				uptime: process.uptime(),
				timestamp: Date.now()
			};

			if (req.url == opts.readiness.path) {
				// Readiness if the broker started successfully.
				// https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-readiness-probes
				const timeout = setTimeout(function() {
					res.writeHead(503, resHeader);
					res.end(JSON.stringify(content, null, 2));
				}, opts.readiness.checkerTimeoutMs);

				opts.readiness.checker(function(error) {
					clearTimeout(timeout);
					res.writeHead((typeof error === 'undefined' && state != 'down') ? 200 : 503, resHeader);
					res.end(JSON.stringify(content, null, 2));
				});
			} else {
				// Liveness if the broker is not stopped.
				// https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-a-liveness-command
				const timeout = setTimeout(function() {
					res.writeHead(503, resHeader);
					res.end(JSON.stringify(content, null, 2));
				}, opts.liveness.checkerTimeoutMs);

				opts.liveness.checker(function(error) {
					clearTimeout(timeout);
					res.writeHead((typeof error === 'undefined' && state != 'down') ? 200 : 503, resHeader);
					res.end(JSON.stringify(content, null, 2));
				});
			}
		} else {
			res.writeHead(404, http.STATUS_CODES[404], {});
			res.end();
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
				const port = server.address().port;

				broker.healthcheck.port = port;
				broker.healthcheck.emit('port', port);

				broker.logger.info('');
				broker.logger.info('K8s health-check server listening on');
				broker.logger.info(`    http://localhost:${port}${opts.readiness.path}`);
				broker.logger.info(`    http://localhost:${port}${opts.liveness.path}`);
				broker.logger.info('');
			});
		},

		// After broker started
		started(broker) {
			state = 'up';
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
