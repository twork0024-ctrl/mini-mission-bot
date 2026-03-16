const express = require('express');
const cors = require('cors');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const app = express();
app.use(cors());
app.use(express.json());

// Dictionary to track active bot instances
const activeBots = {};

// SSE Clients array for the Live Web Console
let sseClients = [];

// Helper function to broadcast logs to the website
function broadcastLog(level, message) {
  const logEntry = JSON.stringify({ level, message, time: new Date().toLocaleTimeString() });
  console.log(`[${level}] ${message}`); // Keep logging to terminal
  
  sseClients.forEach(client => {
    client.res.write(`data: ${logEntry}\n\n`);
  });
}

// SSE Endpoint for the Website to connect to
app.get('/api/logs', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ level: 'SYSTEM', message: 'Connected to Bot Control Server.', time: new Date().toLocaleTimeString() })}\n\n`);
  
  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient); // Track the new connection

  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
  });
});

app.post('/api/spawn-bot', (req, res) => {
  const { botName } = req.body;

  if (!botName) {
    return res.status(400).json({ success: false, message: 'Missing bot name.' });
  }

  // Check if we already have a bot spawned with this name
  if (activeBots[botName]) {
    broadcastLog('WARNING', `Spawn aborted: '${botName}' is already logged into the server.`);
    return res.json({ 
      success: false, 
      message: `The bot '${botName}' is already logged into the server!` 
    });
  }

  broadcastLog('SYSTEM', `Received request to spawn bot named: ${botName}`);

  res.json({ 
    success: true, 
    message: `Connecting... Your friend ${botName} will be online in a moment!` 
  });

  // Spawn bot
  const bot = mineflayer.createBot({
    host: 'nikalukadata.aternos.me',
    port: 29932,
    username: botName, 
    version: '1.20.4'
  });

  bot.loadPlugin(pathfinder);

  let isAuthenticated = false;

  bot.once('spawn', () => {
    broadcastLog('SUCCESS', `${botName} has spawned in the world.`);
    activeBots[botName] = bot; // Track the active bot
    // We do NOT chat or move yet! We must wait for AuthMe.
  });

  // AuthMe Auto-Login/Register Listeners
  bot.on('messagestr', (message) => {
    if (message.trim() !== '') {
        broadcastLog('CHAT', `[Minecraft] ${message}`);
    }
    
    const text = message.toLowerCase();

    // If server asks to register
    if (text.includes('/register') && !isAuthenticated) {
      broadcastLog('SYSTEM', `Server requires AuthMe registration. Registering...`);
      setTimeout(() => bot.chat('/register SmartBotPass123! SmartBotPass123!'), 1000);
    }

    // If server asks to login
    if (text.includes('/login') && !isAuthenticated) {
      broadcastLog('SYSTEM', `Server requires AuthMe login. Logging in...`);
      setTimeout(() => bot.chat('/login SmartBotPass123!'), 1000);
    }

    // Success detection (AuthMe usually says something like "Successfully logged in" or "registered")
    if ((text.includes('success') || text.includes('logged in') || text.includes('registered')) && !isAuthenticated && !text.includes('/register') && !text.includes('/login')) {
      isAuthenticated = true;
      broadcastLog('SUCCESS', `AuthMe authentication successful! Initializing behaviors...`);
      
      setTimeout(() => {
        bot.chat(`Hello everyone! I am a smart companion named ${botName}. Tell me to 'follow' you or 'stop'!`);
        
        // Setup Pathfinding movements for the world
        const defaultMove = new Movements(bot);
        bot.pathfinder.setMovements(defaultMove);
      }, 1000);
    }
  });

  // Smart Chat Listeners
  bot.on('chat', (username, message) => {
    if (username === bot.username) return; // Don't reply to self

    const cmd = message.toLowerCase().trim();
    
    // Command: follow [botName]
    if (cmd === `follow ${bot.username.toLowerCase()}`) {
      broadcastLog('COMMAND', `${username} ordered ${botName} to follow them.`);
      const target = bot.players[username]?.entity;

      if (!target) {
        bot.chat(`I can't see you, ${username}! Are you near me?`);
        return;
      }

      bot.chat(`I'm following you, ${username}! Lead the way!`);
      const dynamicGoal = new goals.GoalFollow(target, 2); // Stay within 2 blocks
      bot.pathfinder.setGoal(dynamicGoal, true); // true = keep tracking them as they move
    }

    // Command: stop [botName]
    if (cmd === `stop ${bot.username.toLowerCase()}`) {
      broadcastLog('COMMAND', `${username} ordered ${botName} to stop following.`);
      bot.chat(`Okay, I will stay right here.`);
      bot.pathfinder.setGoal(null); // Clear the pathfinding goal
      bot.clearControlStates(); // Stop all movement
    }

    // Command: leave [botName]
    if (cmd === `leave ${bot.username.toLowerCase()}`) {
      broadcastLog('COMMAND', `${username} ordered ${botName} to leave the server.`);
      bot.chat(`Goodbye, everyone! It was fun!`);
      setTimeout(() => bot.quit(), 1000);
    }
  });

  bot.on('end', () => {
    broadcastLog('WARNING', `${botName} has disconnected from the server.`);
    delete activeBots[botName]; // Remove from tracking
  });

  bot.on('error', (err) => {
    broadcastLog('ERROR', `Bot Error: ${err.message}`);
    delete activeBots[botName];
  });
});

const PORT = process.env.PORT || 3000;
try {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Smart Bot Spawner server is listening on port ${PORT}...`);
    console.log(`[API] Waiting for requests from the website...`);
  });
} catch (err) {
  console.error('[FATAL SERVER ERROR]', err);
}
