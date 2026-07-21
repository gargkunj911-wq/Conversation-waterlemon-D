from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
import re

load_dotenv()

chat_model = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite"
)


system = SystemMessage(
content="""
You are an AI Coach Intelligence Assistant.
Analyze ONE day's conversation between a health coach and a client.
Extract all explicit facts accurately.
Also provide brief evidence-based observations that help the coach notice important patterns. Observations must be directly supported by the conversation and should never speculate or diagnose.
If information is missing, write "Not Mentioned."
And add Day [Number] to specify which days data are u telling
Return ONLY the following format.
# Daily Client Report
Sleep
Hydration
Nutrition
Physical Activity
Body Metrics
Symptoms
Mood
Stress
Energy
Coach Advice
Client Concerns
Additional Facts
Key Observations
- 2–5 concise observations based only on the conversation.
- Connect related facts when appropriate.
- Mention other liquids (tea, coffee, juice, coconut water, etc.) separately from water intake.
- Highlight notable behaviour, recurring symptoms, or anything a coach should notice.
"""
)


def _weekly_system_message():
    return SystemMessage(content="""
You are a Client Intelligence Report Generator.
You will receive multiple structured daily reports.
Generate one weekly intelligence report.
Rules
- Use ONLY the supplied reports.
- Never invent information.
- Never infer missing facts and make up facts by your own.
- Identify recurring patterns across the week.
- Mention improvements only when supported.
- Mention recurring problems only when supported.
- Do not rewrite every day.
- Produce a concise report.
Format
CLIENT WEEKLY INTELLIGENCE REPORT
Overall Summary
Nutrition
Hydration
Sleep
Exercise & Physical Activity
Symptoms
Mood & Stress
Energy Levels
Weight & Measurements
Client Challenges
Coach Recommendations Given
Positive Progress
Risk Flags
Overall Engagement
Next Follow-up Areas and anyother things coach must ask client about health and wellbieng
Return only the report with anything you feel worth mentioning.
""")


def _extract_text(content):
    """
    Handles both response shapes seen from ChatGoogleGenerativeAI:
    a plain string, or a list of content blocks like [{"type": "text", "text": "..."}].
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list) and content:
        first = content[0]
        if isinstance(first, dict) and "text" in first:
            return first["text"]
    return str(content)


def generate_reports_stream(conversation_text: str):
    """
    Generator version of the original script.

    Splits the conversation into Day 1..N exactly like before, then for
    each day: calls the model, yields that day's report immediately, and
    keeps building up the weekly context. Once all days are done, calls
    the weekly model and yields that too.

    Yields dicts:
        {"type": "daily", "content": "<day report text>"}
        {"type": "weekly", "content": "<weekly report text>"}
    """
    days = re.split(r"(?=Day\s+\d+)", conversation_text.strip())
    days.pop(0)

    weeklyreport = [_weekly_system_message()]

    for day in days:
        human = HumanMessage(content=day)
        chat = [system, human]
        result = chat_model.invoke(chat)

        daily_text = _extract_text(result.content)

        weeklyreport.append(HumanMessage(content=result.content))

        yield {"type": "daily", "content": daily_text}

    weeklyresult = chat_model.invoke(weeklyreport)
    weekly_text = _extract_text(weeklyresult.content)

    yield {"type": "weekly", "content": weekly_text}


def generate_reports(conversation_text: str) -> dict:
    daily_reports = []
    weekly_report = ""
    for chunk in generate_reports_stream(conversation_text):
        if chunk["type"] == "daily":
            daily_reports.append(chunk["content"])
        elif chunk["type"] == "weekly":
            weekly_report = chunk["content"]
    return {"daily_reports": daily_reports, "weekly_report": weekly_report}