import { Router } from 'express';
import { TokenController } from '../controllers/token-controller';
import { WebSocketServer } from '../websocket/websocket-server';

const createTokenRoutes = (wsServer: WebSocketServer): Router => {
  const router = Router();
  const tokenController = new TokenController(wsServer);

  // GET /api/tokens - Get all tokens with filters
  router.get('/', (req, res) => tokenController.getTokens(req, res));

  // GET /api/tokens/trending - Get trending tokens (merged from both APIs)
  router.get('/trending', (req, res) => tokenController.getTrending(req, res));

  // GET /api/tokens/volume - Get tokens by volume (merged from both APIs)
  router.get('/volume', (req, res) => tokenController.getByVolume(req, res));

  // GET /api/tokens/:address - Get specific token (must be after other routes)
  router.get('/:address', (req, res) => tokenController.getToken(req, res));

  // POST /api/tokens/refresh - Refresh token data
  router.post('/refresh', (req, res) => tokenController.refreshTokens(req, res));

  return router;
};

export default createTokenRoutes; 