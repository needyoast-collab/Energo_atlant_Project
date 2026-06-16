function createReq({ params = {}, session = {}, body = {} } = {}) {
  return {
    params,
    session,
    body,
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    redirectStatus: null,
    redirectUrl: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    redirect(status, url) {
      this.redirectStatus = status;
      this.redirectUrl = url;
      return this;
    },
  };
}

function createNext() {
  const next = (err) => {
    next.error = err || null;
  };
  next.error = null;
  return next;
}

module.exports = {
  createNext,
  createReq,
  createRes,
};
