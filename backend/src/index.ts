import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

app.get('/projects', async (req, res) => {
  try {
    const { data } = await axios.get(`${process.env.COOLIFY_API_URL}/api/v1/projects`, {
      headers: {
        Authorization: `Bearer ${process.env.COOLIFY_API_KEY}`,
      },
    });

    console.log("Received data from Coolify API:", JSON.stringify(data, null, 2));

    // Check if the response is an array directly, or has a .projects property
    const projectList = Array.isArray(data) ? data : data.projects;

    if (!projectList) {
      throw new Error("Invalid data structure from Coolify API. Expected an array of projects.");
    }

    const projects = projectList.map((project: any) => ({
      name: project.name,
      fqdn: project.fqdn,
      status: project.status,
      updatedAt: project.updatedAt,
    }));

    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`);
});
