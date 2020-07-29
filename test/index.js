const test = require('ava');
const { ServiceBroker } = require('moleculer');
const fetch = require('node-fetch');
const HealthMiddleware = require('..');

const event = (emitter, eventName) =>
  new Promise((resolve) => emitter.once(eventName, resolve));

const startBroker = async (healthCheckOpts = {}) => {
  const broker = new ServiceBroker({
    middlewares: [HealthMiddleware({
      port: 0,
      ...healthCheckOpts
    })],
  });
  broker.createService({
    name: 'void',
  });
  await broker.start();

  let port;
  if (!broker.healthcheck.port) {
    port = await event(broker.healthcheck, 'port');
  } else {
    port = broker.healthcheck.port;
  }

  return { broker, port };
}

test.beforeEach(async (t) => {
  const { broker, port } = await startBroker();
  t.context.broker = broker;
  t.context.healthport = port;
});

test.afterEach(async (t) => {
  await t.context.broker.stop();
});

test('healthcheck endpoints are responding', async (t) => {
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${t.context.healthport}/${e}`))
  );
  t.snapshot(responses.map((r) => r.status));
  t.snapshot(
    (await Promise.all(responses.map((r) => r.json()))).map((j) => j.state)
  );
});

test('healthcheck should not respond if broker is stopped', async (t) => {
  await t.context.broker.stop();

  const endpoints = ['ready', 'live'];
  const errors = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${t.context.healthport}/${e}`).catch(error => error))
  );
  t.snapshot(errors.map((e) => e.name));
});

test('custom liveness checker can be given in parameter', async (t) => {
  const { broker, port } = await startBroker({
    liveness: {
      checker: (next) => { next('Error'); }
    },
    readiness: {
      checker: (next) => { next('Error'); }
    }
  })

  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${port}/${e}`).catch(error => error))
  );
  t.snapshot(responses.map((r) => r.status));
  await broker.stop();
});

test('if custom checker liveness does not invoke callback it returns an error', async (t) => {
  const { broker, port } = await startBroker({
    liveness: {
      checker: () => {},
      checkerTimeoutMs: 500
    },
    readiness: {
      checker: () => {},
      checkerTimeoutMs: 500
    }
  });

  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${port}/${e}`).catch(error => error))
  );
  t.snapshot(responses.map((r) => r.status));
  await broker.stop();
});

test('accessing the broker using the createChecker factory', async (t) => {
  const { broker, port } = await startBroker({
    liveness: {
      createChecker: (b) => (next) => { next(b.healthcheck.port); }
    },
    readiness: {
      createChecker: (b) => (next) => { next(b.healthcheck.port); }
    }
  });

  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${port}/${e}`).catch(error => error))
  );
  t.snapshot(responses.map((r) => r.status));
  await broker.stop();
});