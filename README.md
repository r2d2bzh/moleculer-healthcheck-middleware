# Health-check middleware for Moleculer

The following originally comes from a gist available here:
https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

Most credits go to [@icebob](https://github.com/icebob).
This repository only provides us a way to publish, maintain and perhaps customize this middleware.

This module is available on the public NPM registry:

```sh
npm install @r2d2bzh/moleculer-healthcheck-middleware
```

Use it for Kubernetes liveness & readiness checks.
The middleware opens a HTTP server on port 3001.
To check, open the http://localhost:3001/live & http://localhost:3001/ready URLs.

## Response

```js
{
  "state": "up",
  "uptime": 7.419,
  "timestamp": 1562790370161
}
```
> The `state` can be `"starting"` (503), `"up"` (200), `"stopping"` (503) or `"down"` (503).

## Usage

**Load with default options**

```js
// moleculer.config.js
const HealthMiddleware = require('@r2d2bzh/moleculer-healthcheck-middleware');

module.exports = {
  middlewares: [
    HealthMiddleware()
  ]
};
```

**Load with custom options**

```js
// moleculer.config.js
const HealthMiddleware = require('@r2d2bzh/moleculer-healthcheck-middleware');

module.exports = {
  middlewares: [
    HealthMiddleware({
      port: 3333,
      readiness: {
        path: "/ready"
      },
      liveness: {
        path: "/live"
      }
    })
  ]
};
```

In order to check liveness and/or readiness a little deeper, you can also give the module your own *checker function* which takes a callback.
If you give a parameter to the `next` callback you will tell the middlware to fail the liveness and/or readiness check.
Also if you do not respond in a certain amount of time, the liveness and/or readiness check will fail.

```js
// moleculer.config.js
const HealthMiddleware = require('@r2d2bzh/moleculer-healthcheck-middleware');

module.exports = {
  middlewares: [
    HealthMiddleware({
      liveness: {
        checkerTimeoutMs: 20000, // default value
        checker: function(next) {
          // Execute here your liveness check...
          if (ok) {
            next();
          } else {
            next('error');
          }
        },
      },
    }),
  ],
};
```

The checker can also be initialized through a *createChecker* factory which takes the broker as a parameter.
Provide your own implementation of *createChecker* to the healthcheck middleware if you need the checker function to have access to the broker.
It will be called during the *started* Moleculer middleware hook.

```js
const HealthMiddleware = require('@r2d2bzh/moleculer-healthcheck-middleware');

module.exports = {
  middlewares: [
    HealthMiddleware({
      liveness: {
        createChecker: (broker) =>
          (next) => {
            if (ok) {
              broker.getLogger('healthcheck').info('Everything is fine.');
              next();
            } else {
              broker.getLogger('healthcheck').error('error');
              next('error');
            }
          }
        }
    }),
  ],
};
```

### Usage in Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: greeter
spec:
  selector:
    matchLabels:
      app: greeter
  replicas: 1
  template:
    metadata:
      labels:
        app: greeter
    spec:
      containers:
      - name: greeter
        image: moleculer/demo:1.4.2
        livenessProbe:
          httpGet:
            path: /live
            port: 3001
        readinessProbe:
          httpGet:
            path: /ready
            port: 3001
```
