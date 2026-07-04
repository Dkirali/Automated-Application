const FEATURES = [
  {
    title: "Your resume stays yours",
    body: "Used only to score and tailor. Never shared, never sold.",
  },
  {
    title: "Nothing sent without you",
    body: "You review and approve every single application.",
  },
  {
    title: "Delete anything, anytime",
    body: "One click removes your data for good.",
  },
];

function ShieldCheck() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="mt-0.5 shrink-0 text-accent"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** Dark trust panel shown on the onboarding split-screen (setup + LinkedIn steps). */
export function OnboardingAside() {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-[26px] w-[26px] place-items-center rounded-md bg-accent text-[14px] font-bold text-white"
        >
          J
        </span>
        <span className="font-serif text-[21px] font-semibold text-cream">
          JobBot
        </span>
      </div>

      <div className="flex flex-col gap-8">
        <h1 className="font-serif text-[30px] font-medium leading-[1.2] text-cream">
          Set up once. We&apos;ll take it from there.
        </h1>
        <ul className="flex flex-col gap-[18px]">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3">
              <ShieldCheck />
              <div>
                <div className="text-[14px] font-bold text-cream">{f.title}</div>
                <div className="text-[13px] leading-[1.5] text-[#b3a898]">
                  {f.body}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[12.5px] text-[#8a8072]">
        Your data is stored locally on your machine — never on our servers.
      </p>
    </>
  );
}
