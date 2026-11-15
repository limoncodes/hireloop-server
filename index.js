import express from 'express';
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(express.json())
app.use(cors())
const client = new MongoClient(process.env.BETTER_AUTH_DB_URL);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const connectedClient = await connectToMongoDB()
const database = connectedClient.db("hireloopdb")
const users = database.collection("user")
const jobs = database.collection("jobs")

app.get('/', (req, res) => {
  res.send('hire loop is looping');
});
app.get("/users", async (req, res) => {
  const cursor = users.find({})
  const result = await cursor.toArray()
  res.send(result)
})
// jobs related apis
app.post("/jobs", async (req, res) => {
  // defaults the user never sends from the form

  const job = {
    ...req.body,
    status: "Active",
    applicants: 0,
  }
  const result = await jobs.insertOne(job);
  res.send(result)

})

app.get('/jobs', async (req, res) => {
  const query = {};

  // console.log('query', req.query);

  if (req.query) {
    if (req.query.jobType) {
      query.jobType = {
        $regex: req.query.jobType,
        $options: "i"
      };
    }

    if (req.query.remote) {
      query.remote = req.query.remote === "true";
    }
    if(req.query.category){
      query.category = req.query.category
    }

    if (req.query.search) {
      // "+backend+dev" means " backend dev" in URLs — trim so
      // leading/trailing spaces never break the regex
      const search = String(req.query.search).trim();

      query.$or = [
        {
          title: {
            $regex: search,
            $options: "i"
          }
        },
        {
          responsibilities: {
            $regex: search,
            $options: "i"
          }
        },
        {
          requirements: {
            $regex: search,
            $options: "i"
          }
        }
      ];
    }
  }

  const result = await jobs.find(query).toArray();

  res.send(result);
});

app.delete("/jobs/:id", async (req, res) => {
  const id = req.params.id
  const query = { _id: new ObjectId(id) };
  const result = await jobs.deleteOne(query)
  res.send(result)
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});