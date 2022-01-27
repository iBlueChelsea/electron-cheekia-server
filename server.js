const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

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

  con.query(
    `INSERT INTO users (name,password) VALUES ('${username}','${password}')`,
    (err, result) => {
      if (err) throw err;
      response.send({ userID: result.insertId });
    }
  );
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

const updateGames = (socket, id) => {
  //let query = "SELECT * FROM games WHERE player2 IS NULL LIMIT 10";
  let query = `SELECT * FROM games WHERE id = ${id}`;
  con.query(query, (err, result) => {
    if (err) throw err;
    let games = [];
    result.forEach((row) => {
      let game = row;
      games.push(game);
    });
    socket.broadcast.emit("updateGames", JSON.stringify(games));
  });
};

const newGame = (socket, user) => {
  console.log(user);

  let query = `INSERT INTO games (player1) VALUES (${user})`;

  con.query(query, (err, result) => {
    if (err) throw err;
    updateGames(socket, result.insertId);
  });
};

io.on("connection", (socket) => {
  console.log(socket.id);
  socket.on("newGame", (user) => {
    newGame(socket, user);
  });
});
