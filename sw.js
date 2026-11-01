// Content-addressed resources survive deployments. HTML stays network-first;
// tiles retain their independent offline cache. Keep two shell generations so
// old tabs can still request their exact script URLs after a worker update.
const SHELL_VERSION = 'shell-b71cc77c';
