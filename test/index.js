const test = require('ava');
const { ServiceBroker } = require('moleculer');
const fetch = require('node-fetch');
const HealthMiddleware = require('..');

const event = (emitter, eventName) =>
  new Promise((resolve) => emitter.once(eventName, resolve));

const startBroker = async (t, healthCheckOpts = {}) => {
  const broker = new ServiceBroker({
    middlewares: [HealthMiddleware({
      port: 0,
      ...healthCheckOpts
    })],
    logLevel: 'warn',
  });
  broker.createService({
    name: 'void',
  });
  await broker.start();

  t.context.broker = broker;
  t.context.healthport = broker.healthcheck.port || await event(broker.healthcheck, 'port');
}

test.afterEach.always(async (t) => {
  if(t.context.broker) {
    await t.context.broker.stop();
  }
});

test('healthcheck endpoints are responding', async (t) => {
  await startBroker(t);

  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${t.context.healthport}/${e}`))
  );
  t.snapshot(responses.map((r) => r.status));
  t.snapshot(
    (await Promise.all(responses.map((r) => r.json()))).map((j) => j.state)
  );
});

test('live endpoint answers multiple times', async (t) => {
  const checkEndpoint = async (endpoint) => {
    const response = await fetch(endpoint)
    t.snapshot(response.status);
    t.snapshot((await response.json()).state);
  };
  await startBroker(t);
  for (let i=0; i<10; ++i) {
    await checkEndpoint(`http://127.0.0.1:${t.context.healthport}/live`);
  }
});

test('healthcheck should not respond if broker is stopped', async (t) => {
  const endpoints = ['ready', 'live'];
  const errors = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${t.context.healthport}/${e}`).catch(error => error))
  );
  t.snapshot(errors.map((e) => e.name));
});

test('custom liveness checker can be given in parameter', async (t) => {
  await startBroker(t, {
    liveness: {
      checker: (next) => { next('Error'); }
    },
    readiness: {
      checker: (next) => { next('Error'); }
    }
  });

  const port = t.context.healthport;
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${port}/${e}`))
  );
  t.snapshot(responses.map((r) => r.status));
});

test('if custom checker liveness does not invoke callback it returns an error', async (t) => {
  await startBroker(t, {
    liveness: {
      checker: () => {},
      checkerTimeoutMs: 500
    },
    readiness: {
      checker: () => {},
      checkerTimeoutMs: 500
    }
  });

  const port = t.context.healthport;
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${port}/${e}`))
  );
  t.snapshot(responses.map((r) => r.status));
});

test('accessing the broker using the createChecker factory', async (t) => {
  await startBroker(t, {
    liveness: {
      createChecker: (b) => (next) => { next(b.healthcheck.port); }
    },
    readiness: {
      createChecker: (b) => (next) => { next(b.healthcheck.port); }
    }
  });

  const port = t.context.healthport;
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(
    endpoints.map((e) => fetch(`http://127.0.0.1:${port}/${e}`))
  );

  await Promise.all(
    responses.map(async (res) => {
      const body = await res.json();
      t.deepEqual(body, port);
    })
  );
});
