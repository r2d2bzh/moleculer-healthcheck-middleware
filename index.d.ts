declare function _default(options?: HealthCheckOptions): HealthCheckMiddleware;
export default _default;
export type CheckerCallback = (errorMessage?: unknown) => void;
export type Checker = (next: CheckerCallback) => void;
export type ProbeOptions = {
    path?: string | undefined;
    checker?: Checker | undefined;
    /**
     * Called when the broker is started
     */
    createChecker?: ((broker: any) => Checker) | undefined;
    checkerTimeoutMs?: number | undefined;
};
export type HealthCheckOptions = {
    /**
     * `0` lets the system choose a free port
     */
    port?: number | undefined;
    readiness?: ProbeOptions | undefined;
    liveness?: ProbeOptions | undefined;
};
export type HealthCheckMiddleware = {
    created: (broker: any) => void;
    started: (broker: any) => void;
    stopping: () => void;
    stopped: () => void;
};
