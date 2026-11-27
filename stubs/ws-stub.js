// ws es una librería WebSocket para Node.js.
// En React Native existe un WebSocket nativo global — lo usamos como stub.
// ethers importa 'ws' en providers/ws.js; la app no abre WebSocket,
// pero Metro necesita resolver el módulo.

// Exportar el WebSocket nativo de React Native como si fuera el módulo ws.
const WebSocketClass = global.WebSocket || class WebSocket {};

// Compatibilidad con imports: import WS from 'ws'  y  import { WebSocket } from 'ws'
WebSocketClass.WebSocket = WebSocketClass;
WebSocketClass.createWebSocketStream = () => null;
WebSocketClass.WebSocketServer = class WebSocketServer {
  constructor() {
    throw new Error('WebSocketServer no disponible en React Native');
  }
};
WebSocketClass.Server = WebSocketClass.WebSocketServer;

module.exports = WebSocketClass;
module.exports.default = WebSocketClass;
