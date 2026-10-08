const { ethers } = require("ethers");

function invalid(res, name, value) {
  return res.status(400).json({
    error: `${name} must be a blockchain address starting with 0x (42 characters), e.g. 0x7099...79C8 -- got "${value}"`,
  });
}

/** Rejects the request unless every named body field that is present is a valid 0x address. */
function addressFields(...names) {
  return (req, res, next) => {
    for (const name of names) {
      const value = req.body && req.body[name];
      if (value !== undefined && !ethers.isAddress(value)) return invalid(res, name, value);
    }
    next();
  };
}

/** For router.param(name, validateAddressParam): rejects invalid :name URL parameters. */
function validateAddressParam(req, res, next, value, name) {
  if (!ethers.isAddress(value)) return invalid(res, name, value);
  next();
}

module.exports = { addressFields, validateAddressParam };
