# ChatGPT companion setup

The site includes **Continue in ChatGPT**, which opens ChatGPT with a visitor's question and the public graph JSON URL. It uses the visitor's existing ChatGPT session; the site does not send the question to an API or receive the response.

If an eligible ChatGPT Business, Enterprise, or Edu workspace allows custom GPT creation, use this document to create a companion GPT. Upload `data/industrial-graph.json` as Knowledge, enable Data Analysis, and use these instructions:

> You explain the Industrial Music Knowledge Graph. Treat the uploaded JSON as the factual record. Distinguish people, projects, releases, and songs. Explain graph paths and topology only from the recorded nodes and relationships. Cite provenance URLs when present. Do not infer an undocumented membership, credit, release, date, or influence. When the record cannot answer, say what evidence is missing and invite a sourced correction.

Suggested conversation starters:

- Who has the highest equally weighted composite score?
- How is Al Jourgensen related to Marilyn Manson?
- Which projects connect these two people?
- What evidence supports this relationship?

New custom GPT creation and public publishing are subject to the creator's ChatGPT workspace eligibility and permissions. This repository does not create, own, or embed a ChatGPT GPT.
