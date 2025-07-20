"use client";

import { useEffect, useState } from "react";

interface Project {
  name: string;
  fqdn: string;
  status: string;
  updatedAt: string;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch("http://localhost:3001/projects"); // Replace with your backend URL
        if (!res.ok) {
          throw new Error("Failed to fetch projects");
        }
        const data = await res.json();
        setProjects(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Coolify Dashboard</h1>
      {loading && <p>Loading projects...</p>}
      {error && <p className="text-red-500">{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {projects.map((project) => (
          <div
            key={project.name}
            className="bg-white rounded-lg shadow-md p-6"
          >
            <h2 className="text-xl font-semibold mb-2">{project.name}</h2>
            <p className="text-gray-600 mb-4">
              Status:{" "}
              <span
                className={`px-2 py-1 rounded-full text-sm ${
                  project.status === "running"
                    ? "bg-green-200 text-green-800"
                    : "bg-red-200 text-red-800"
                }`}
              >
                {project.status}
              </span>
            </p>
            <p className="text-gray-500 text-sm mb-4">
              Last updated: {new Date(project.updatedAt).toLocaleString()}
            </p>
            <a
              href={`https://${project.fqdn}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              View Deployment
            </a>
          </div>
        ))}
      </div>
    </main>
  );
}