import express, { application } from 'express';
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

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
const applicants = database.collection('applicants')
const payments = database.collection("payments")

app.get('/', (req, res) => {
  res.send('hire loop is looping');
});
app.get("/users", async (req, res) => {
  const cursor = users.find({})
  const result = await cursor.toArray()
  res.send(result)
})
app.get('/users/:id/premium', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ premium: false, message: 'Invalid user id' })
    }
    const query = { _id: new ObjectId(id) };
    const user = await users.findOne(query, { projection: { premium: 1 } })
    return res.json({ premium: user?.premium === true })
  } catch (error) {
    console.error('get premium error:', error)
    return res.status(500).json({
      premium: false,
      message: error instanceof Error ? error.message : 'Could not check premium status',
    })
  }
})
// payment 
app.post('/payment/checkout_verify', async (req, res) => {
  const { sessionid } = req.body;

  if (!sessionid) {
    return res.status(400).json({ success: false, message: 'Missing session id' })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionid)
    const {
      status,
      customer_email,
      metadata,
      payment_intent,
      payment_status,
    } = session

    if (status !== 'complete' || payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
      })
    }

    // The frontend puts the logged-in user id in the Checkout Session metadata.
    if (!metadata?.userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId in session metadata',
      })
    }

    const payment = {
      sessionid,
      status,
      payment_status,
      customer_email,
      userId: metadata.userId,
      payment_intent,
      payment_date: new Date()
    }
    // `payments` is the Mongo collection; `payment` is just the document.
    const result = await payments.insertOne(payment)

    const query = { _id: new ObjectId(metadata.userId) }
    const updateDoc = { $set: { premium: true } }
    const UpdateResult = await users.updateOne(query, updateDoc)

    return res.json({ success: true, result, UpdateResult })
  } catch (error) {
    console.error('checkout_verify error:', error)
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Verification failed',
    })
  }
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
app.get('/jobs/:id', async (req, res) => {
  const id = req.params.id
  const query = { _id: new ObjectId(id) }
  const result = await jobs.findOne(query)
  res.send(result)
})

app.get('/jobs', async (req, res) => {
  const query = {};

  // console.log('query', req.query);

  if (req.query) {
    // A recruiter's Manage Jobs page sends ?recruiterId=<user id> —
    // only that recruiter's own jobs should come back.
    if (req.query.recruiterId) {
      query.recruiterId = String(req.query.recruiterId);
    }

    if (req.query.jobType) {
      query.jobType = {
        $regex: req.query.jobType,
        $options: "i"
      };
    }

    if (req.query.remote) {
      query.remote = req.query.remote === "true";
    }
    if (req.query.category) {
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

  // Newest jobs first — ObjectId begins with a timestamp, so sorting by
  // _id descending puts the most recently posted jobs at the top.
  const result = await jobs.find(query).sort({ _id: -1 }).toArray();

  res.send(result);
});

app.delete("/jobs/:id", async (req, res) => {
  const id = req.params.id
  const query = { _id: new ObjectId(id) };
  const result = await jobs.deleteOne(query)
  res.send(result)
})
app.post("/applicants", async (req, res) => {
  const applicantion = req.body;
  const result = await applicants.insertOne(applicantion)
  res.send(result)
})
// all applications — or only one user's with ?email=...
// (same pattern as the jobs filtering: /applicants?email=seeker@gmai.com)
app.get('/applicants', async (req, res) => {
  const query = {};
  if (req.query.email) {
    query.email = req.query.email;
  }
  // Recruiter's job applications page filters by jobId
  if (req.query.jobId) {
    query.jobId = String(req.query.jobId);
  }
  // Newest applications first
  const result = await applicants.find(query).sort({ _id: -1 }).toArray();
  res.send(result);
})
app.get('/applicants/count', async (req, res) => {
  const query = {};
  if (req.query.email) {
    query.email = req.query.email;
  }
  const result = await applicants.countDocuments(query)

  res.send({ count: result });
})

// Dynamically update any editable field on one application.
// The recruiter review table sends { status: "Review" } etc.
app.patch('/applicants/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid application id' })
    }

    // Only whitelisted fields can be changed — _id / jobId stay untouched.
    const editable = ['status', 'email', 'userId', 'jobTitle', 'companyName']
    const update = {}
    for (const key of editable) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key]
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' })
    }

    const result = await applicants.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...update, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )

    if (!result) {
      return res.status(404).json({ success: false, message: 'Application not found' })
    }

    return res.json({ success: true, result })
  } catch (error) {
    console.error('PATCH /applicants/:id error:', error)
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Update failed',
    })
  }
})


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});