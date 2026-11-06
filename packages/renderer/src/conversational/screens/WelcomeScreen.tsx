// Welcome screen (spec §15 M3 / issue #12). Driven by the optional document
// `welcome` config (SPEC-NOTE: shape pending T06 alignment — re-ticketed with the issue #30 follow-up).
// Enter anywhere starts the flow (wired by the parent via a window listener).
export function WelcomeScreen(props: {
  title: string;
  body?: string;
  buttonText?: string;
  onStart: () => void;
}) {
  const { title, body, buttonText = 'Start', onStart } = props;
  return (
    <section className="ff-screen" aria-labelledby="ff-welcome-title">
      <h1 id="ff-welcome-title" className="ff-question-label" style={{ fontSize: 30 }}>
        {title}
      </h1>
      {body && <p className="ff-question-desc">{body}</p>}
      <button type="button" className="ff-continue" onClick={onStart}>
        {buttonText} <span aria-hidden="true">→</span>
      </button>
      <p className="ff-hint" aria-hidden="true">
        press <kbd>Enter</kbd> ↵
      </p>
    </section>
  );
}
