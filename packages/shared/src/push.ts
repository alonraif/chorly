// The browsers' push services. The server POSTs to whatever endpoint a device registered,
// so nothing else is accepted or sent to: not the home network, not other containers.
// This package builds without DOM or Node typings; WHATWG URL exists in every runtime that imports it.
declare const URL: new (input: string) => { protocol: string; port: string; username: string; password: string; hostname: string };

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function isPushServiceEndpoint(value: string) {
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && PUSH_HOSTS.some((host) => host.test(url.hostname));
}
