# Health-check middleware for Moleculer

The following originally comes from a gist available here:
https://gist.github.com/icebob/c717ae22002b9ecaa4b253a67952da3a

Most credits go to [@icebob](https://github.com/icebob).
This repository only provides us a way to publish, maintain and perhaps customize this middleware.

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
const HealthMiddleware = require("./health-check.middleware.js");

module.exports = {
  middlewares: [
    HealthMiddleware()
  ]
};
```

**Load with custom options**

```js
// moleculer.config.js
const HealthMiddleware = require("./health-check.middleware.js");

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
