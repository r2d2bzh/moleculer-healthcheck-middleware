const test = require('ava');
const { ServiceBroker } = require('moleculer');
const fetch = require('node-fetch');
const HealthMiddleware = require('..');

const event = (emitter, eventName) => new Promise(resolve => emitter.once(eventName, resolve));

test.beforeEach(async t => {
  t.context.broker = new ServiceBroker({
    logger: false,
    middlewares: [ HealthMiddleware({ port: 0 }) ]
  });
  t.context.broker.createService({
    name: 'void'
  });
  await t.context.broker.start();
  t.context.healthport = await event(t.context.broker.healthcheck, 'port');
});

test.afterEach(t => t.context.broker.stop());

test('healthcheck endpoints are responding', async t => {
  const endpoints = ['ready', 'live'];
  const responses = await Promise.all(endpoints.map(e => fetch(`http://127.0.0.1:${t.context.healthport}/${e}`)));
  t.snapshot(responses.map(r => r.status));
  t.snapshot((await Promise.all(responses.map(r => r.json()))).map(j => j.state));
});
