# Taskflow

A personal task manager built with React, Node.js, and SQLite. Add tasks, set their priority, track progress, and celebrate every mission completed.

## Features

- Create, complete, and delete tasks
- Set a low, medium, or high priority
- Search tasks and filter by status
- View a live summary of your progress
- Save tasks to a local SQLite database

## Requirements

- Node.js 22.5 or later. The project uses the built-in `node:sqlite` module.

## Getting started

Open a terminal in the project folder and install the dependencies:

```powershell
npm install
```

Start the API, database, and React development server together:

```powershell
npm run dev
```

Open the local address printed in the terminal. Keep the terminal open while using the app. Press `Ctrl+C` in that terminal to stop the development servers.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the API and React development server |
| `npm run server` | Start only the Node.js API |
| `npm run build` | Create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Check the source files with Oxlint |

## Project structure

- `src/App.jsx` — React interface, task form, filters, search, and API requests
- `src/App.css` — app layout, component styles, and responsive design
- `src/index.css` — global styles and color settings
- `server/index.js` — Node.js HTTP API and SQLite queries
- `data/tasks.sqlite` — local task database, created automatically when the API starts
- `vite.config.js` — forwards `/api` requests to the local API during development
- `dev.js` — starts and stops the API and Vite together

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/tasks` | Get all tasks |
| `POST` | `/api/tasks` | Create a task |
| `PATCH` | `/api/tasks/:id` | Update a task's completion status |
| `DELETE` | `/api/tasks/:id` | Delete a task |

The API keeps its original priority values so existing database records remain compatible. The interface displays them as Low, Medium, and High.

## Learning path

1. Explore React state and event handlers in `src/App.jsx`.
2. Follow how the form sends requests with `fetch`.
3. Read how the Node.js API handles `GET`, `POST`, `PATCH`, and `DELETE`.
4. Look at the SQLite table and parameterized queries in `server/index.js`.
5. See how the responsive interface is styled in `src/App.css` and `src/index.css`.

## Data and privacy

Tasks are saved in the local `data/tasks.sqlite` file on this computer. The app does not include user accounts or online sync. If an older task list is found in browser storage, it is imported once when the SQLite database is empty.
