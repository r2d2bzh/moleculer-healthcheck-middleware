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

const createSlowBroker = (hooks) => {
  const broker = new ServiceBroker({ middlewares: [HealthMiddleware({ port: 0 })], logLevel: 'warn' });
  broker.createService({ name: 'slow', ...hooks });
  return broker;
};

const probeStatuses = (port) =>
  Promise.all(
    ['ready', 'live'].map(async (endpoint) => {
      const { status } = await fetch(`http://127.0.0.1:${port}/${endpoint}`);
      return status;
    }),
  );

test('probes fail while the broker is starting', async (t) => {
  let releaseStart;
  const broker = createSlowBroker({ started: () => new Promise((resolve) => (releaseStart = resolve)) });
  t.context.broker = broker;
  const starting = broker.start();
  const port = broker.healthcheck.port || (await event(broker.healthcheck, 'port'));

  t.deepEqual(await probeStatuses(port), [503, 503]);
  releaseStart();
  await starting;
  t.deepEqual(await probeStatuses(port), [200, 200]);
});

test('probes fail while the broker is stopping', async (t) => {
  let releaseStop;
  let notifyStopping;
  const stoppingReached = new Promise((resolve) => (notifyStopping = resolve));
  const broker = createSlowBroker({
    stopped: () => {
      notifyStopping();
      return new Promise((resolve) => (releaseStop = resolve));
    },
  });
  await broker.start();
  const port = broker.healthcheck.port || (await event(broker.healthcheck, 'port'));

  const stopping = broker.stop();
  await stoppingReached;
  t.deepEqual(await probeStatuses(port), [503, 503]);
  releaseStop();
  await stopping;
});

test('options given by the caller are left untouched', (t) => {
  const options = { readiness: { path: '/custom' } };
  HealthMiddleware(options);
  t.deepEqual(options, { readiness: { path: '/custom' } });
});

test('a createChecker factory not returning a function fails the broker start', async (t) => {
  const broker = new ServiceBroker({
    middlewares: [HealthMiddleware({ port: 0, liveness: { createChecker: () => 'not a function' } })],
    logLevel: 'fatal',
  });
  await t.throwsAsync(() => broker.start(), { message: /liveness.createChecker\(\) result is not a function/ });
  await broker.stop();
});
