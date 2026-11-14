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
app.get("/users", async(req,res)=>{
    const cursor = users.find({})
    const result = await cursor.toArray()
    res.send(result)
})
// jobs related apis
app.post("/jobs",async (req,res)=>{
  // defaults the user never sends from the form
  const job = {
    ...req.body,
    status: "Active",
    applicants: 0,
  }
  const result = await jobs.insertOne(job);
  res.send(result)

})
app.get('/jobs', async(req,res)=>{
  const cursor = jobs.find();
  const result = await cursor.toArray()
  res.send(result)
})
app.delete("/jobs/:id",async (req,res)=>{
  const id = req.params.id
  const query = {_id:new ObjectId(id)};
  const result = await jobs.deleteOne(query)
  res.send(result)
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});