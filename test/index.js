import test from 'ava';
import { ServiceBroker } from 'moleculer';
import HealthMiddleware from '../index.js';

import { fetch } from 'undici';

const event = (emitter, eventName) => new Promise((resolve) => emitter.once(eventName, resolve));

const startBroker = async (t, healthCheckOptions = {}) => {
  const broker = new ServiceBroker({
    middlewares: [
      HealthMiddleware({
        port: 0,
        ...healthCheckOptions,
      }),
    ],
    logLevel: 'warn',
  });
  broker.createService({
    name: 'void',
  });
  await broker.start();

  t.context.broker = broker;
  t.context.healthport = broker.healthcheck.port || (await event(broker.healthcheck, 'port'));
};

test.afterEach.always(async (t) => {
  if (t.context.broker) {
    await t.context.broker.stop();
  }
});

test('healthcheck endpoints are responding', async (t) => {
  await startBroker(t);

  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((endpoint) => fetch(`http://127.0.0.1:${t.context.healthport}/${endpoint}`)),
  );
  t.snapshot(responses.map((r) => r.status));
  const states = await Promise.all(responses.map((r) => r.json()));
  t.snapshot(states.map((index) => index.state));
});

test('live endpoint answers multiple times', async (t) => {
  const checkEndpoint = async (endpoint) => {
    const response = await fetch(endpoint);
    t.snapshot(response.status);
    const { state } = await response.json();
    t.snapshot(state);
  };
  await startBroker(t);
  for (let index = 0; index < 10; ++index) {
    await checkEndpoint(`http://127.0.0.1:${t.context.healthport}/live`);
  }
});

test('custom liveness checker can be given in parameter', async (t) => {
  await startBroker(t, {
    liveness: {
      checker: (next) => {
        next('Error');
      },
    },
    readiness: {
      checker: (next) => {
        next('Error');
      },
    },
  });

  const port = t.context.healthport;
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(endpoints.map((endpoint) => fetch(`http://127.0.0.1:${port}/${endpoint}`)));
  t.snapshot(responses.map((r) => r.status));
});

test('if custom checker liveness does not invoke callback it returns an error', async (t) => {
  await startBroker(t, {
    liveness: {
      checker: () => {},
      checkerTimeoutMs: 500,
    },
    readiness: {
      checker: () => {},
      checkerTimeoutMs: 500,
    },
  });

  const port = t.context.healthport;
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(endpoints.map((endpoint) => fetch(`http://127.0.0.1:${port}/${endpoint}`)));
  t.snapshot(responses.map((r) => r.status));
});

test('if custom checker liveness invokes the callback after the timeout', async (t) => {
  await startBroker(t, {
    liveness: {
      checker: (done) => {
        setTimeout(() => done(), 400);
      },
      checkerTimeoutMs: 200,
    },
  });

  const { status } = await fetch(`http://127.0.0.1:${t.context.healthport}/live`);
  t.snapshot(status);
  // This is to detect ERR_STREAM_WRITE_AFTER_END errors
  await new Promise((resolve) => setTimeout(resolve, 600));
});

test('accessing the broker using the createChecker factory', async (t) => {
  await startBroker(t, {
    liveness: {
      createChecker: (b) => (next) => {
        next(b.healthcheck.port);
      },
    },
    readiness: {
      createChecker: (b) => (next) => {
        next(b.healthcheck.port);
      },
    },
  });

  const port = t.context.healthport;
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(endpoints.map((endpoint) => fetch(`http://127.0.0.1:${port}/${endpoint}`)));

  await Promise.all(
    responses.map(async (response) => {
      const body = await response.json();
      t.deepEqual(body, port);
    }),
  );
});
