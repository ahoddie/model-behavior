import Link from "@/components/Link";

export const metadata = { title: "About · Model Behavior" };

export default function About() {
  return (
    <div className="page about">
      <h1>About</h1>
      <p>
        Trace how frontier AI labs, investors, tech leaders, and think tanks shape U.S. AI policy through who funds whom, who
        works where, what they say in public, and which bills, rules, and races they weigh in on.
      </p>
      <p>
        It was inspired by <a href="https://dconai.org">DConAI.org</a>, which scores how each member of Congress talks about
        AI from verified quotes. Model Behavior asks the same question about the people and companies outside government.
      </p>
      <p>
        Maintained by <a href="https://allegrahoddie.com">Allegra Hoddie</a>. See the <Link href="/data?view=methodology">methodology</Link> and <Link href="/data?view=corrections">corrections</Link>.
      </p>
    </div>
  );
}
