/* Starter question banks. Review before using with a client.
 * Once a bank with the same ID is saved from the trainer console, the saved copy replaces this one. */
'use strict';

module.exports = [
  {
    "id": "GENAI-WORKPLACE",
    "title": "Generative AI at work (starter set)",
    "questions": [
      {
        "topic": "Basics",
        "text": "What does it mean when a generative AI tool \"hallucinates\"?",
        "options": [
          "It refuses to answer the question",
          "It produces confident but incorrect or made-up information",
          "It runs slowly because of heavy load",
          "It repeats the prompt back to you"
        ],
        "correct": 1
      },
      {
        "topic": "Data privacy",
        "text": "You want help summarising a client contract. What is the right first step?",
        "options": [
          "Paste the full contract into any free public chatbot",
          "Check your company AI policy and use an approved tool, removing confidential details if required",
          "Email the contract to a personal account and use AI from home",
          "Avoid AI completely for any document"
        ],
        "correct": 1
      },
      {
        "topic": "Prompting",
        "text": "Which prompt is most likely to give a useful first draft?",
        "options": [
          "\"Write an email\"",
          "\"Email to client\"",
          "\"You are an account manager. Write a 120-word email to a client explaining a two-day delivery delay, apologise once, offer a revised date, keep a polite tone.\"",
          "\"Write something professional and good\""
        ],
        "correct": 2
      },
      {
        "topic": "Prompting",
        "text": "Giving the AI two or three sample input-output pairs before your actual request is called:",
        "options": [
          "Few-shot prompting",
          "Fine-tuning",
          "Data labelling",
          "Prompt injection"
        ],
        "correct": 0
      },
      {
        "topic": "Verification",
        "text": "An AI tool gives you a market-size figure for a board presentation. What should you do?",
        "options": [
          "Use it as is because AI is trained on large data",
          "Round it off and use it",
          "Verify it against a reliable, citable source before using it",
          "Ask the AI if it is sure and use it if it says yes"
        ],
        "correct": 2
      },
      {
        "topic": "Prompting",
        "text": "The first answer from the AI is too generic. What usually works best?",
        "options": [
          "Start a new chat and ask the same question",
          "Refine the prompt with more context, constraints and the output format you want",
          "Type the question in capital letters",
          "Accept it, since AI output cannot be improved"
        ],
        "correct": 1
      },
      {
        "topic": "Concepts",
        "text": "What is Retrieval-Augmented Generation (RAG) mainly used for?",
        "options": [
          "Making the model respond faster",
          "Grounding answers in your own documents or data sources",
          "Generating images from text",
          "Translating code between languages"
        ],
        "correct": 1
      },
      {
        "topic": "Concepts",
        "text": "The \"context window\" of a language model refers to:",
        "options": [
          "The size of the chat window on screen",
          "How much text the model can consider at one time, including your prompt and its reply",
          "The number of users who can use the tool at once",
          "The date range of the training data"
        ],
        "correct": 1
      },
      {
        "topic": "Responsible use",
        "text": "Which use of generative AI most needs a qualified human to review the output before acting on it?",
        "options": [
          "Drafting a team lunch invitation",
          "Brainstorming names for an internal project",
          "A final credit, legal or medical decision",
          "Reformatting a list into a table"
        ],
        "correct": 2
      },
      {
        "topic": "Responsible use",
        "text": "Why can AI-generated output be biased?",
        "options": [
          "Because models learn patterns from data that may contain human biases",
          "Because AI tools are designed to have opinions",
          "Because bias only appears when the internet is slow",
          "AI output cannot be biased"
        ],
        "correct": 0
      }
    ]
  },
  {
    "id": "AI-FOR-LEADERS",
    "title": "AI for leaders and managers (starter set)",
    "questions": [
      {
        "topic": "Use cases",
        "text": "Which makes the strongest first AI use case for a business team?",
        "options": [
          "The most complex process in the company",
          "A high-volume, repetitive task with clear quality checks and measurable time or cost",
          "A process nobody currently owns",
          "Whatever a competitor announced last week"
        ],
        "correct": 1
      },
      {
        "topic": "ROI",
        "text": "What is the best way to judge whether an AI pilot worked?",
        "options": [
          "Number of employees who logged in once",
          "Comparing agreed baseline metrics (time, cost, quality, errors) before and after",
          "Feedback from the vendor",
          "How advanced the model is"
        ],
        "correct": 1
      },
      {
        "topic": "Governance",
        "text": "An AI usage policy for employees should cover at minimum:",
        "options": [
          "Approved tools, what data may and may not be shared, and who reviews outputs",
          "Only the list of banned websites",
          "Only the budget for AI licences",
          "Nothing, since teams should experiment freely"
        ],
        "correct": 0
      },
      {
        "topic": "Risk",
        "text": "\"Human-in-the-loop\" means:",
        "options": [
          "A person reviews or approves AI output at defined points before it takes effect",
          "Humans are replaced by AI step by step",
          "Employees must type all prompts by hand",
          "Customers must talk to a human first"
        ],
        "correct": 0
      },
      {
        "topic": "Strategy",
        "text": "When does building a custom AI solution usually make more sense than buying an off-the-shelf tool?",
        "options": [
          "Always, because custom is cheaper",
          "When the process is a core differentiator and depends on proprietary data that tools cannot handle well",
          "When the team wants to learn coding",
          "Never"
        ],
        "correct": 1
      },
      {
        "topic": "Data",
        "text": "Which is the most common reason AI projects stall after the pilot?",
        "options": [
          "The model is not large enough",
          "Poor data quality, unclear ownership and no integration into daily workflow",
          "Too many employees want to use it",
          "The pilot was too successful"
        ],
        "correct": 1
      },
      {
        "topic": "Change",
        "text": "What most improves employee adoption of a new AI tool?",
        "options": [
          "Announcing it by email only",
          "Role-specific training, clear use cases and a manager who uses it visibly",
          "Making it optional and never mentioning it",
          "Tracking every keystroke"
        ],
        "correct": 1
      },
      {
        "topic": "Scaling",
        "text": "After a successful pilot, what is the sensible next step?",
        "options": [
          "Roll out to every department at once",
          "Document results, fix gaps, set governance and scale in phases with owners and metrics",
          "Stop and wait for better models",
          "Hand it over to the vendor fully"
        ],
        "correct": 1
      }
    ]
  }
];
