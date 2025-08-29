Website Automation Agent

This project demonstrates a Playwright-powered website automation agent built using OpenAI Agents SDK
.
The agent can open a browser, navigate to websites, find elements, fill forms, take screenshots, and interact with buttons intelligently.

🚀 Features

✅ Open and close Chromium browser

✅ Navigate to URLs

✅ Find elements by text, class, id, or placeholder

✅ Click elements by visible text or coordinates

✅ Fill signup/login forms with intelligent label/placeholder matching

✅ Take labeled screenshots (saved to /screenshots/)

✅ Run fully automated signup/login flows via an AI agent

📂 Project Structure
.
├── index.js         # Main script with agent and tools
├── package.json     
├── .env             # Environment variables (optional)
├── screenshots/     # Auto-created folder for screenshots
└── README.md        

⚙️ Installation

Clone the repo:

git clone https://github.com/sudhesh15/agent-sdk-browseruse.git
cd website-automation-agent


Install dependencies:

npm install


Required packages:

@openai/agents

playwright

zod

dotenv

Install Playwright browsers:

npx playwright install


(Optional) Configure .env:

OPENAI_API_KEY=your_openai_api_key

▶️ Usage

Run the agent with:

node index.js


The example script will:

Open browser

Go to https://ui.chaicode.com

Find and click Sign Up

Take a screenshot (saved in /screenshots/)

Fill the signup form with values:

First Name: Sudhesh
Last Name: Holla
Email: sudheshholla15@gmail.com
Password: admin123
Confirm Password: admin123


Click Create Account

🛠 Tools Implemented

open_browser → Launches Playwright Chromium instance

open_url → Navigates to a given URL

take_screenshot → Saves a screenshot in /screenshots/

find_elements → Finds clickable elements by search terms

click_element → Clicks by visible text or coordinates

fill_form_fields → Intelligently fills forms (labels, placeholders, names, IDs)

close_browser → Closes browser instance

📸 Screenshots

Screenshots are stored in:

/screenshots/shot-<timestamp>-<label>.png

Screenrecording - https://www.youtube.com/watch?v=6xUyjRoDSLk


Example:

screenshots/shot-1693333333333-signup.png
