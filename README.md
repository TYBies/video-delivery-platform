# Videographer Delivery Platform

This is a Next.js platform for videographers to upload videos and share download links with clients. It's designed to be a practical project for learning and practicing DevOps and automation.

## Features

- **Hybrid Storage:** Automatically fails over from local to cloud (R2) storage.
- **Secure Links:** Generates secure, shareable download links.
- **Broad Format Support:** Supports MP4, MOV, AVI, MKV, and WebM.
- **Large File Handling:** Optimized for large uploads with progress tracking.
- **Modern UI:** A clean, professional, and responsive user interface.

## Prerequisites

- Node.js (v18 or later)
- npm (v9 or later)
- (Optional) Docker for containerized deployment

## Getting Started

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd videographer-platform
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure environment variables:**
    Create a `.env.local` file by copying the example:
    ```bash
    cp .env.local.example .env.local
    ```
    Update the variables in `.env.local` as needed.

## Running the Application

- **Development:**

  ```bash
  npm run dev
  ```

  The application will be available at `http://localhost:3000`.

- **Production:**
  ```bash
  npm run build
  npm run start
  ```

## Running Tests

- **Unit Tests:**

  ```bash
  npm run test
  ```

- **End-to-End Tests:**
  ```bash
  npm run test:e2e
  ```

## Architectural Overview

This is a Next.js application with a React-based frontend and a backend powered by Next.js API routes. It uses a hybrid storage system, prioritizing local storage and automatically failing over to a cloud-based R2 bucket.

For a more detailed breakdown, see the [Architecture Documentation](docs/architecture.md).

## Deployment

This project is designed to be deployed using modern DevOps practices. For detailed instructions on containerizing with Docker and setting up a CI/CD pipeline, see the [Deployment Guide](docs/deployment.md).
