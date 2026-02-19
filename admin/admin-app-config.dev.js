// Development runtime config for admin (mount this in dev only)
window._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_GLOB_API_URL: 'http://localhost:4000/api',
  VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
  VITE_GLOB_AUTH_DINGDING_CLIENT_ID: ''
};

Object.freeze(window._VBEN_ADMIN_PRO_APP_CONF_);
Object.defineProperty(window, '_VBEN_ADMIN_PRO_APP_CONF_', {
  configurable: false,
  writable: false,
});
