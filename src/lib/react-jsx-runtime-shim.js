import React from 'react';

const Fragment = React.Fragment;

const withKey = (props, key) => {
  if (key === undefined || key === null) return props || {};
  return { ...(props || {}), key };
};

const jsx = (type, props, key) => React.createElement(type, withKey(props, key));
const jsxs = jsx;
const jsxDEV = (type, props, key) => React.createElement(type, withKey(props, key));

export { Fragment, jsx, jsxs, jsxDEV };
export default { Fragment, jsx, jsxs, jsxDEV };
