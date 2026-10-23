import { createRemoteJWKSet, jwtVerify } from 'jose';

// A API não faz login e não guarda senhas: quem autentica é o Keycloak.
// Aqui apenas VERIFICAMOS o token que o cliente (Bruno) apresenta:
//   1. a assinatura bate com as chaves públicas do Keycloak (JWKS)?
//   2. o emissor ("iss") é o nosso realm?
//   3. o token ainda não expirou ("exp")?
export function createAuth({ issuer }) {
  // Endereço padrão do Keycloak com as chaves públicas do realm.
  // O "jose" baixa as chaves na primeira requisição e guarda em cache.
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}/protocol/openid-connect/certs`)
  );

  // Middleware: exige "Authorization: Bearer <token>" e preenche req.user.
  async function authenticate(req, res, next) {
    const [scheme, token] = (req.headers.authorization || '').split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        error: 'Token ausente. Envie o header "Authorization: Bearer <token>".',
      });
    }

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });

      if (!payload.preferred_username) {
        return res.status(401).json({ error: 'Token sem "preferred_username".' });
      }

      req.user = {
        id: payload.sub,
        username: payload.preferred_username,
        // O Keycloak coloca os roles do realm em realm_access.roles
        roles: payload.realm_access?.roles ?? [],
      };
      next();
    } catch (err) {
      // err.code ajuda a descobrir o motivo (ex.: ERR_JWT_EXPIRED)
      console.warn('Token rejeitado:', err.code ?? err.message);
      res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
  }

  // Middleware: libera a rota se o usuário tiver PELO MENOS UM dos roles.
  function requireRole(...allowedRoles) {
    return (req, res, next) => {
      const ok = allowedRoles.some((role) => req.user.roles.includes(role));
      if (!ok) {
        return res.status(403).json({
          error: `Acesso negado. Requer o perfil: ${allowedRoles.join(' ou ')}.`,
        });
      }
      next();
    };
  }

  return { authenticate, requireRole };
}
