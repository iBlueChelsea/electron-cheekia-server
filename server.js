const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const GameData = require("./GameData");

const mysql = require("mysql");
const cors = require("cors");
const md5 = require("md5");

const con = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "R00t+",
  port: "3308",
  database: "cheekia",
});

con.connect((err) => {
  if (err) throw err;
  console.log("Connected!");
});

//app.get("/", (req, res) => {
//  res.sendFile(__dirname + "/index.html");
//});

app.use(express.json());
app.use(cors());

app.post("/login", (request, response) => {
  const username = request.body.username;
  const password = md5(request.body.password);

  con.query(`SELECT * FROM users WHERE name='${username}'`, (err, result) => {
    if (err) throw err;
    if (result.length > 0) {
      let fetchedRow = result.shift();
      if (fetchedRow.password == password) {
        response.send({ userID: fetchedRow.id });
      } else {
        response.send({ error: "Wrong Password!" });
      }
    } else {
      con.query(
        `INSERT INTO users (name,password) VALUES ('${username}','${password}')`,
        (err, result) => {
          if (err) throw err;
          response.send({ userID: result.insertId });
        }
      );
    }
  });
});

app.post("/get-decks", (request, response) => {
  const user = request.body.user;

  con.query(`SELECT * FROM decks WHERE player = '${user}'`, (err, result) => {
    if (err) throw err;
    const decks = [];
    result.forEach((row) => {
      row.cards = JSON.parse(row.cards);
      decks.push(row);
    });
    response.send(decks);
  });
});

app.get("/get-cards", (request, response) => {
  const params = request.query;

  let query = "SELECT * FROM cards WHERE playable=1";

  if (params.name) {
    query += ` AND name LIKE '%${params.name}%'`;
  }

  if (params.land) {
    if (params.land === "neutral") {
      query += " AND forest=0 AND lake=0 AND mountain=0 AND desert=0";
    } else {
      query += ` AND ${params.land} > 0`;
    }
  }

  query += " ORDER BY faeria, name";

  con.query(query, (err, result) => {
    if (err) throw err;
    response.send(result);
  });
});

app.post("/save-deck", (request, response) => {
  const user = request.body.user;
  const deck = JSON.parse(request.body.deck);

  let selectQuery = `SELECT * FROM decks WHERE id = ${deck.id}`;

  con.query(selectQuery, (err, result) => {
    if (err) throw err;
    let saveQuery;

    if (result.length > 0) {
      saveQuery = `UPDATE decks SET deck_name = '${deck.deck_name}', cover = ${
        deck.cover
      }, cards = '${JSON.stringify(deck.cards)}', cost = ${
        deck.cost
      } WHERE id = ${deck.id}`;
    } else {
      saveQuery = `INSERT INTO decks (player, deck_name, cover, cards, cost) VALUES (${user}, '${
        deck.deck_name
      }', ${deck.cover}, '${JSON.stringify(deck.cards)}', ${deck.cost})`;
    }
    con.query(saveQuery, (err, result) => {
      if (err) throw err;
      response.send(result);
    });
  });
});

server.listen(3001, () => {
  console.log("Server running...");
});

const updateGames = (socket, isPrivate = false) => {
  let query =
    "SELECT g.id as id, p1.name as player1, p2.name as player2 FROM games g LEFT JOIN users p1 ON g.player1 = p1.id LEFT JOIN users p2 ON g.player2 = p2.id WHERE player2 IS NULL ORDER BY g.id DESC LIMIT 10";

  con.query(query, (err, result) => {
    if (err) throw err;
    let games = [];
    result.forEach((row) => {
      let game = {
        id: row.id,
        player1: row.player1,
        player2: row.player2,
      };
      games.push(game);
    });
    if (isPrivate) {
      io.to(socket.id).emit("updateGames", JSON.stringify(games));
    } else {
      socket.broadcast.emit("updateGames", JSON.stringify(games));
    }
  });
};

const newGame = (socket, userId) => {
  let userQuery = `SELECT name FROM users WHERE id = ${userId}`;
  con.query(userQuery, (err, result) => {
    if (err) throw err;
    if (result.length > 0) {
      let fetchedRow = result.shift();
      let userName = fetchedRow.name;

      let gameData = new GameData();
      gameData.statePlayer1.name = userName;

      let stateData = JSON.stringify(gameData.stateData);
      let statePlayer1 = JSON.stringify(gameData.statePlayer1);
      let statePlayer2 = JSON.stringify(gameData.statePlayer2);

      let query = `INSERT INTO games (player1, state_data, state_player1, state_player2) VALUES (${userId}, '${stateData}', '${statePlayer1}', '${statePlayer2}')`;

      con.query(query, (err, result) => {
        if (err) throw err;
        let gameRoom = "game" + result.insertId;
        socket.join(gameRoom);
        socket.emit("redirectToGame", result.insertId);
        updateGames(socket);
      });
    }
  });
};

const joinGame = (socket, userId, gameId) => {
  let gameRoom = "game" + gameId;

  let userQuery = `SELECT name FROM users WHERE id = ${userId}`;
  con.query(userQuery, (err, result) => {
    if (err) throw err;
    if (result.length > 0) {
      let fetchedRow = result.shift();
      let userName = fetchedRow.name;
      let selectQuery = `SELECT state_player2 from games WHERE id = ${gameId}`;
      con.query(selectQuery, (err, result) => {
        if (err) throw err;
        if (result.length > 0) {
          fetchedRow = result.shift();
          let playerState = JSON.parse(fetchedRow.state_player2);
          playerState.name = userName;
          playerState = JSON.stringify(playerState);
          let updateQuery = `UPDATE games SET player2 = ${userId}, state_player2 = '${playerState}' WHERE id = ${gameId}`;
          con.query(updateQuery, (err, result) => {
            if (err) throw err;
            socket.join(gameRoom);
            socket.to(gameRoom).emit("playerJoined", userName);
            socket.emit("redirectToGame", gameId);
            updateGames(socket);
          });
        }
      });
    }
  });
};

const updateGameState = (socket, gameId) => {
  let query = `SELECT state_data FROM games WHERE id = ${gameId}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    let fetchedRow = result.shift();
    socket.emit("updateGameState", fetchedRow.state_data);
  });
};

const getInitialState = (socket, gameId, userId, player) => {
  let query = `SELECT state_data, state_player1, state_player2 FROM games WHERE id = ${gameId}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    let fetchedRow = result.shift();
    let gameData = new GameData();
    let stateData = JSON.parse(fetchedRow.state_data);
    stateData.data.player1 = JSON.parse(fetchedRow.state_player1);
    stateData.data.player2 = JSON.parse(fetchedRow.state_player2);
    let stateUI = gameData.stateUI;
    let cardsQuery = `SELECT * FROM cards`;
    con.query(cardsQuery, (err, result) => {
      if (err) throw err;
      let cards = [];
      result.forEach((row) => {
        cards.push(gameData.getCard(row));
      });
      stateData.cardLibrary = cards;
      let intialState = {
        ...stateUI,
        ...stateData,
      };

      let decksQuery = `SELECT * FROM decks WHERE player = ${userId}`;

      const userDeckList = [];

      con.query(decksQuery, (err, result) => {
        if (err) throw err;
        result.forEach((row) => {
          let deck = { id: row.id, deck_name: row.deck_name, cover: row.cover };
          userDeckList.push(deck);
        });

        let returnData = {
          initialState: intialState,
          userDeckList: userDeckList,
        };
        socket.emit("getInitialState", JSON.stringify(returnData));
      });
    });
  });
};

const selectDeck = (socket, gameId, player, deck) => {
  let gameRoom = "game" + gameId;

  let query = `UPDATE games SET ${player}_deck = ${deck.id} WHERE id = ${gameId}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    socket.to(gameRoom).emit("opponentDeckSelected", deck.cover);
  });
};

const setOpponentReady = (socket, gameId) => {
  socket.to("game" + gameId).emit("setOpponentReady");
};

const getUserRole = (socket, userId, gameId) => {
  let userRole = "spectate";
  let userName = "Spectator";
  let opponentName = "";

  let query = `SELECT player1, player2, state_player1, state_player2 FROM games WHERE id = ${gameId}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    if (result.length > 0) {
      let fetchedRow = result.shift();
      if (fetchedRow.player1 == userId) {
        userRole = "player1";
        let playerState = JSON.parse(fetchedRow.state_player1);
        userName = playerState.name;
      }
      if (fetchedRow.player2 == userId) {
        userRole = "player2";
        let playerState1 = JSON.parse(fetchedRow.state_player1);
        let playerState2 = JSON.parse(fetchedRow.state_player2);
        userName = playerState2.name;
        opponentName = playerState1.name;
      }
    }
    socket.emit("getUserRole", {
      userRole: userRole,
      userName: userName,
      opponentName: opponentName,
    });
  });
};

const getDeck = (socket, gameId, player) => {
  let deckQuery = `SELECT ${player}_deck AS deckId FROM games WHERE id = ${gameId}`;
  con.query(deckQuery, (err, result) => {
    if (err) throw err;
    if (result.length > 0) {
      let fetchedRow = result.shift();
      let cardsQuery = `SELECT cards FROM decks WHERE id = ${fetchedRow.deckId}`;
      con.query(cardsQuery, (err, result) => {
        if (err) throw err;
        if (result.length > 0) {
          let fetchedRow = result.shift();
          socket.emit("getDeck", fetchedRow.cards);
        }
      });
    }
  });
};

const saveStatePlayer = (socket, action, gameId, player, statePlayer) => {
  let gameRoom = "game" + gameId;

  let query = `UPDATE games SET state_${player} = '${statePlayer}' WHERE id = ${gameId}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    socket.to(gameRoom).emit("updateStatePlayer", action, player, statePlayer);
  });
};

const saveStateData = (socket, action, gameId, stateData) => {
  let gameRoom = "game" + gameId;

  let query = `UPDATE games SET state_data = '${stateData}' WHERE id = ${gameId}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    socket.to(gameRoom).emit("updateStateData", action, stateData);
  });
};

const saveStatePlayerAndData = (
  socket,
  action,
  gameId,
  player,
  statePlayer,
  stateData
) => {
  let gameRoom = "game" + gameId;

  let query = `UPDATE games SET state_${player} = '${statePlayer}', state_data = '${stateData}' WHERE id = ${gameId}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    socket
      .to(gameRoom)
      .emit("updateStatePlayerAndData", action, player, statePlayer, stateData);
  });
};

io.on("connection", (socket) => {
  socket.on("initGames", () => {
    updateGames(socket, true);
  });
  socket.on("newGame", (userId) => {
    newGame(socket, userId);
  });
  socket.on("joinGame", (userId, gameId) => {
    joinGame(socket, userId, gameId);
  });
  socket.on("getInitialState", (gameId, userId, player) => {
    getInitialState(socket, gameId, userId, player);
  });
  socket.on("updateGameState", (gameId) => {
    updateGameState(socket, gameId);
  });
  socket.on("selectDeck", (gameId, player, deckId) => {
    selectDeck(socket, gameId, player, deckId);
  });
  socket.on("getDeck", (gameId, player) => {
    getDeck(socket, gameId, player);
  });
  socket.on("setReady", (gameId) => {
    setOpponentReady(socket, gameId);
  });
  socket.on("getUserRole", (userId, gameId) => {
    getUserRole(socket, userId, gameId);
  });

  socket.on("saveStateData", (action, gameId, stateData) => {
    saveStateData(socket, action, gameId, stateData);
  });
  socket.on("saveStatePlayer", (action, gameId, player, statePlayer) => {
    saveStatePlayer(socket, action, gameId, player, statePlayer);
  });
  socket.on(
    "saveStatePlayerAndData",
    (action, gameId, player, statePlayer, stateData) => {
      saveStatePlayerAndData(
        socket,
        action,
        gameId,
        player,
        statePlayer,
        stateData
      );
    }
  );
});
