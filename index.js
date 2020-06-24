// The following originally comes from a gist available here:
// https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

"use strict";

const http = require("http");
const EventEmitter = require('events');

const dflt = function(current, ifUndefined) {
	return typeof current !== undefined ? ifUndefined : current;
};

module.exports = function(opts) {
	opts = dflt(opts, {});
	opts.port = dflt(opts.port, 3001);
	opts.readiness = dflt(opts.readiness, {});
	opts.liveness = dflt(opts.liveness, {});
	opts.readiness.path = dflt(opts.readiness.path, "/ready");
	opts.liveness.path = dflt(opts.liveness.path, "/live");

	let state = "down";
	let server;

	function handler(req, res) {
		if (req.url == opts.readiness.path || req.url == opts.liveness.path) {
			const resHeader = {
				"Content-Type": "application/json; charset=utf-8"
			};

			const content = {
				state,
				uptime: process.uptime(),
				timestamp: Date.now()
			};

			if (req.url == opts.readiness.path) {
				// Readiness if the broker started successfully.
				// https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-readiness-probes
				res.writeHead(state == "up" ? 200 : 503, resHeader);
			} else {
				// Liveness if the broker is not stopped.
				// https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-a-liveness-command
				res.writeHead(state != "down" ? 200 : 503, resHeader);
			}

			res.end(JSON.stringify(content, null, 2));

		} else {
			res.writeHead(404, http.STATUS_CODES[404], {});
			res.end();
		}
	}

	return {
		created(broker) {
			broker.healthcheck = new EventEmitter();
			state = "starting";

			server = http.createServer(handler);
			server.on("request", handler);
			server.listen(opts.port, err => {
				if (err) {
					return broker.logger.error("Unable to start health-check server", err);
				}

				// listening port is chosen by NodeJS if opts.port === 0
				const port = server.address().port;

				broker.healthcheck.emit('port', port);

				broker.logger.info("");
				broker.logger.info("K8s health-check server listening on");
				broker.logger.info(`    http://localhost:${port}${opts.readiness.path}`);
				broker.logger.info(`    http://localhost:${port}${opts.liveness.path}`);
				broker.logger.info("");
			});
		},

		// After broker started
		started(broker) {
			state = "up";
		},

		// Before broker stopping
		stopping(broker) {
			state = "stopping";
		},

		// After broker stopped
		stopped(broker) {
			state = "down";
			server.close();
		}
	};
};
