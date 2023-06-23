const axios = require('axios');
const jwkToPem = require('jwk-to-pem');
const jwt = require('jsonwebtoken');

const generatePolicy = function (user, effect, resource) {
  const authResponse = {
    principalId: user.sub || 'anonymous',
  };

  if (effect && resource) {
    const policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    const statementOne = {};
    statementOne.Action = 'execute-api:Invoke';
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }

  authResponse.context = {
    id: user.sub,
    email_verified: user.email_verified,
    first_name: user.given_name,
    picture: user.picture,
    last_name: user.family_name,
    email: user.email,
  };

  return authResponse;
};

module.exports.user = (event, context, callback) => {
  if (!event.authorizationToken) {
    console.error('No auth token was provided.');
    console.log(event);
    return callback('Unauthorized');
  }

  const tokenParts = event.authorizationToken.split(' ');
  const tokenValue = tokenParts[1];

  if (!(tokenParts[0].toLowerCase() === 'bearer' && tokenValue)) {
    // no auth token!
    console.error('Auth token could not be split');
    console.log(event.authorizationToken);
    return callback('Unauthorized');
  }

  const token = tokenValue;

  try {
    axios
      .get(
        'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1/.well-known/jwks.json',
        { headers: { 'Content-Type': 'application/json' } }
      )
      .then((response) => {
        const body = response.data;
        let pems = {};
        const keys = body['keys'];
        keys.forEach((key) => {
          const keyId = key.kid;
          const modulus = key.n;
          const exponent = key.e;
          const keyType = key.kty;
          const jwk = { kty: keyType, n: modulus, e: exponent };
          const pem = jwkToPem(jwk);
          pems[keyId] = pem;
        });
        const decodedJwt = jwt.decode(token, { complete: true });
        if (!decodedJwt) {
          console.error(`Token could not be decoded.`);
          return callback('Unauthorized');
        }
        const kid = decodedJwt['header'].kid;
        const pem = pems[kid];
        if (!pem) {
          console.error(`No token supplied.`);
          return callback('Unauthorized');
        }
        jwt.verify(token, pem, (verifyError, payload) => {
          if (verifyError) {
            console.error('verifyError', verifyError);
            // 401 Unauthorized
            console.error(`Token invalid. ${verifyError}`);
            return callback('Unauthorized');
          } else {
            return callback(null, generatePolicy(payload, 'Allow', '*'));
          }
        });
      })
      .catch((err) => {
        console.error('catch error. Invalid token', err);
        return callback('Unauthorized');
      });
  } catch (err) {
    console.error('catch error. Invalid token', err);
    return callback('Unauthorized');
  }
};
