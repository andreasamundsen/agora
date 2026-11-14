import { Debate, DebateEdge, DebateNode, message, reconcileDebate } from "./model";

/**
 * Two hand-authored maps so the app is worth opening before any API key is
 * configured. They also serve as reference examples of the graph shape the
 * authoring prompt asks the model to produce.
 */

interface SeedNode extends Partial<DebateNode> {
  id: string;
}

const transitNodes: SeedNode[] = [
  {
    id: "thesis",
    kind: "statement",
    title: "Cities should make public transit free at the point of use",
    text: "Fares should be abolished on buses, trams and metro systems, with the lost revenue replaced through general taxation.",
    stance: "neutral",
    speaker: "you",
    tags: ["motion", "user"],
    group: "The motion",
    premises: []
  },
  {
    id: "pro-access",
    kind: "argument",
    title: "Mobility is basic infrastructure, not a product",
    text: "A city already provides roads, pavements and emergency services without an admission fee. Transit is the one basic network that still charges at the gate, which rations opportunity by ability to pay.",
    stance: "pro",
    speaker: "advocate",
    tags: ["equity", "public-goods"],
    group: "For the motion",
    premises: [
      "Cities already provide the transport network — roads and pavements — without a per-use charge.",
      "Transit is the only basic network that charges admission before it delivers the service.",
      "A charge at the gate turns access to work, school and care into a privilege of income."
    ],
    conclusion: "Fares should be removed, just as tolls were removed from the basic street network."
  },
  {
    id: "pro-congestion",
    kind: "argument",
    title: "Free fares cut congestion and speed up boarding",
    text: "Fare collection is slow and expensive to run. Small price changes move a surprising number of marginal trips, and every trip shifted from a car reduces road congestion for everyone.",
    stance: "pro",
    speaker: "advocate",
    tags: ["mobility", "congestion"],
    group: "For the motion",
    premises: [
      "Fare collection slows boarding and consumes a real share of operating budgets.",
      "The price of a trip is salient at the margin, so removing it shifts some car trips to transit.",
      "Fewer cars on the road lowers travel time and pollution for all road users."
    ],
    conclusion: "Free transit reduces both operating friction and road congestion."
  },
  {
    id: "pro-economy",
    kind: "argument",
    title: "The wider economy gains more than the farebox loses",
    text: "Fares are a modest slice of transit agency income, while access to the network unlocks jobs, customers and tax base. A city that moves people more cheaply can afford a larger economy around them.",
    stance: "pro",
    speaker: "advocate",
    tags: ["economics", "fiscal"],
    group: "For the motion",
    premises: [
      "Fares typically cover only a minority of operating costs once collection costs are counted.",
      "Access to reliable transport raises employment and consumer spending in the areas it connects.",
      "A larger local economy returns more in tax revenue than the farebox would have collected."
    ],
    conclusion: "The net fiscal effect of free transit can be positive even when the farebox shrinks."
  },
  {
    id: "pro-climate",
    kind: "argument",
    title: "Free transit is a practical climate lever",
    text: "Transport is a large and stubborn source of emissions. Price is one of the few levers a city can pull quickly, and every marginal rider is a car trip not taken.",
    stance: "pro",
    speaker: "advocate",
    tags: ["climate", "mobility"],
    group: "For the motion",
    premises: [
      "Road transport is a major share of urban emissions and has proved hard to decarbonise quickly.",
      "Fares are a policy lever the city controls directly, unlike vehicle standards or fuel prices.",
      "Even modest modal shift produces emissions reductions immediately, not at fleet-replacement speed."
    ],
    conclusion: "Removing fares is one of the fastest available climate levers for a city."
  },
  {
    id: "con-cost",
    kind: "argument",
    title: "The revenue gap lands on the people it claims to help",
    text: "Fares cover a meaningful share of operating costs. If that money disappears, it is replaced by a broad tax or by service cuts — and both fall hardest on the low-income riders the policy is meant to serve.",
    stance: "con",
    speaker: "challenger",
    tags: ["fiscal", "equity"],
    group: "Against the motion",
    premises: [
      "Fares commonly cover 20–40% of operating costs, and collection itself costs money on top.",
      "Replacement funding comes from broad taxes or from reduced service.",
      "Broad consumption taxes are regressive, while service cuts hit those with the fewest alternatives."
    ],
    conclusion: "The people who gain least from free fares can end up paying most for them."
  },
  {
    id: "con-targeted",
    kind: "argument",
    title: "Targeted help is cheaper and fairer than a universal freebie",
    text: "Most riders can afford a small fare. A means-tested or discounted scheme reaches the people who genuinely cannot, at a fraction of the cost of giving a free ride to every commuter and tourist.",
    stance: "con",
    speaker: "challenger",
    tags: ["equity", "fiscal"],
    group: "Against the motion",
    premises: [
      "The majority of transit riders are not poor; many are commuters with above-median incomes.",
      "Means-tested discounts can be financed for a small share of the cost of universal free fares.",
      "Scarce subsidy is better spent on those who need it than spread across everyone."
    ],
    conclusion: "A targeted scheme delivers more equity per pound than a universal one."
  },
  {
    id: "con-quality",
    kind: "argument",
    title: "Free fares spend the money on the wrong problem",
    text: "Riders say frequency, reliability and cleanliness matter more than price. Making the service free while leaving it infrequent and unreliable is a subsidy for waiting, not a transport policy.",
    stance: "con",
    speaker: "challenger",
    tags: ["service", "implementation"],
    group: "Against the motion",
    premises: [
      "Surveys consistently rank frequency, reliability and safety above fare levels.",
      "A free but infrequent service still fails the trips people actually need to make.",
      "The money spent replacing fares could instead buy more vehicles, crews and maintenance."
    ],
    conclusion: "Service quality, not price, is the binding constraint for most riders."
  },
  {
    id: "con-capacity",
    kind: "argument",
    title: "Free transit can overwhelm a system that cannot expand quickly",
    text: "Buses and trains take years to procure and staff. A sudden surge in demand can produce crowding that drives existing riders away, leaving the network worse for the people who rely on it.",
    stance: "con",
    speaker: "challenger",
    tags: ["implementation", "service"],
    group: "Against the motion",
    premises: [
      "Fleet, depots and trained crews cannot be expanded on the timescale of a fare change.",
      "Crowding is one of the strongest deterrents to transit use.",
      "If new riders crowd out existing ones, the policy can reduce total ridership."
    ],
    conclusion: "A demand shock without capacity investment can make the system worse."
  },
  {
    id: "pro-rebut-targeted",
    kind: "argument",
    title: "Means-testing is itself a barrier",
    text: "The people who most need help are the least likely to navigate forms, prove eligibility and renew paperwork. Universal schemes have far higher take-up precisely because they do not ask permission.",
    stance: "pro",
    speaker: "advocate",
    tags: ["equity", "implementation"],
    group: "Rebuttals",
    premises: [
      "Administrative burden and stigma suppress take-up of means-tested benefits.",
      "Eligibility cliffs punish people for small increases in income.",
      "A universal service has lower enrolment friction and reaches people who would never apply."
    ],
    conclusion: "Universal free fares deliver more support to the poor than a targeted scheme on paper."
  },
  {
    id: "pro-rebut-capacity",
    kind: "argument",
    title: "Capacity is a choice, not a law of nature",
    text: "A demand surge is evidence that the city should invest, not an argument for keeping the fare. Bus lanes and signal priority are cheap, and a visible ridership boom creates the political mandate for fleet expansion.",
    stance: "pro",
    speaker: "advocate",
    tags: ["implementation", "service"],
    group: "Rebuttals",
    premises: [
      "Bus priority measures can add capacity in months rather than years.",
      "Visible overcrowding builds political pressure to fund more service.",
      "Treating demand as a reason to ration access entrenches the underinvestment that caused it."
    ],
    conclusion: "Capacity constraints are a management problem, not a reason to keep fares."
  },
  {
    id: "con-rebut-access",
    kind: "argument",
    title: "Roads are not actually free",
    text: "Drivers pay fuel duties, registration and parking charges. Calling transit 'the only network with a gate' ignores the many prices attached to driving — and the fact that transit is already heavily subsidised.",
    stance: "con",
    speaker: "challenger",
    tags: ["public-goods", "fiscal"],
    group: "Rebuttals",
    premises: [
      "Driving carries fuel taxes, registration fees, insurance and parking costs.",
      "Transit already receives public subsidy per trip in most cities.",
      "The question is not whether to charge, but what mix of charges and subsidies is fairest."
    ],
    conclusion: "The 'roads are free, transit is not' analogy misdescribes both networks."
  },
  {
    id: "con-rebut-congestion",
    kind: "argument",
    title: "The congestion effect is smaller than advertised",
    text: "The fare is a small part of the cost of a trip once time, parking and inconvenience are counted. Tap-and-pay already cuts boarding delays, so the case rests on a modal shift that may never arrive.",
    stance: "con",
    speaker: "challenger",
    tags: ["congestion", "evidence"],
    group: "Rebuttals",
    premises: [
      "Time, parking and reliability dominate the decision to drive for most trips.",
      "Contactless payment reduces boarding friction without sacrificing revenue.",
      "Observed ridership responses to fare changes are often modest and short-lived."
    ],
    conclusion: "Free fares are a weak instrument against congestion compared with pricing and service."
  },
  {
    id: "con-rebut-economy",
    kind: "argument",
    title: "The fiscal dividend is speculative; the revenue loss is certain",
    text: "Tax-base effects are diffuse, long-term and hard to attribute. A transit agency cannot spend a projected economic renaissance, while the lost fare revenue appears in the accounts next quarter.",
    stance: "con",
    speaker: "challenger",
    tags: ["economics", "fiscal"],
    group: "Rebuttals",
    premises: [
      "Agglomeration and tax-base effects accrue over years and are difficult to isolate.",
      "Public budgets are annual and must be balanced with actual revenue.",
      "Promising future growth to cover a current revenue hole is a familiar fiscal mistake."
    ],
    conclusion: "The economic case for free fares is too uncertain to justify a permanent revenue loss."
  },
  {
    id: "pro-rebut-cost",
    kind: "argument",
    title: "Fare revenue is volatile and small compared with the system's value",
    text: "Fare income fluctuates with ridership and is expensive to collect. Treating it as the fiscal foundation of the network overstates its importance and understates the cost of rationing access.",
    stance: "pro",
    speaker: "advocate",
    tags: ["fiscal", "public-goods"],
    group: "Rebuttals",
    premises: [
      "Fare revenue is cyclical and fell sharply during recent crises.",
      "Collection infrastructure and enforcement consume part of what fares raise.",
      "The value of the network to the city is far larger than its farebox."
    ],
    conclusion: "Fares are a fragile funding base and a poor reason to exclude people from the network."
  },
  {
    id: "con-rebut-climate",
    kind: "argument",
    title: "Transit is already the low-carbon option",
    text: "A bus emits far less per passenger than a car even when it is not full. Free fares may add riders without removing many car trips, so the emissions saving is much smaller than the headline suggests.",
    stance: "con",
    speaker: "challenger",
    tags: ["climate", "evidence"],
    group: "Rebuttals",
    premises: [
      "Per-passenger emissions from buses and trains are already far below those of cars.",
      "New riders may replace walking, cycling or off-peak trips rather than driving.",
      "The marginal emissions saving depends on which trips actually switch."
    ],
    conclusion: "Free fares are a weaker climate lever than the ridership headline implies."
  }
];

const transitEdges: Partial<DebateEdge>[] = [
  { from: "pro-access", to: "thesis", type: "support" },
  { from: "pro-congestion", to: "thesis", type: "support" },
  { from: "pro-economy", to: "thesis", type: "support" },
  { from: "pro-climate", to: "thesis", type: "support" },
  { from: "con-cost", to: "thesis", type: "attack" },
  { from: "con-targeted", to: "thesis", type: "attack" },
  { from: "con-quality", to: "thesis", type: "attack" },
  { from: "con-capacity", to: "thesis", type: "attack" },
  { from: "pro-rebut-targeted", to: "con-targeted", type: "attack" },
  { from: "pro-rebut-targeted", to: "thesis", type: "support" },
  { from: "pro-rebut-capacity", to: "con-capacity", type: "attack" },
  { from: "con-rebut-access", to: "pro-access", type: "attack" },
  { from: "con-rebut-congestion", to: "pro-congestion", type: "undercut" },
  { from: "con-rebut-economy", to: "pro-economy", type: "undercut" },
  { from: "pro-rebut-cost", to: "con-cost", type: "undercut" },
  { from: "con-rebut-climate", to: "pro-climate", type: "undercut" }
];

const fourDayNodes: SeedNode[] = [
  {
    id: "thesis",
    kind: "statement",
    title: "The four-day week should become the default full-time schedule",
    text: "Full-time work should mean four days and roughly 32 hours at the same pay, with overtime protection for anything beyond it.",
    stance: "neutral",
    speaker: "you",
    tags: ["motion", "user"],
    group: "The motion",
    premises: []
  },
  {
    id: "pro-productivity",
    kind: "argument",
    title: "Shorter weeks can raise output, not cut it",
    text: "Trials consistently find that compressed hours reduce meetings, sick days and low-value busywork. Firms keep output flat or better while workers gain a day back.",
    stance: "pro",
    speaker: "advocate",
    tags: ["productivity", "evidence"],
    group: "For the motion",
    premises: [
      "Pilot programmes report stable or higher revenue alongside shorter hours.",
      "Fewer hours force teams to cut low-value meetings and administrative overhead.",
      "Rest reduces sickness absence and turnover, both of which cost employers money."
    ],
    conclusion: "A four-day week can be a productivity reform rather than a cost."
  },
  {
    id: "pro-wellbeing",
    kind: "argument",
    title: "The extra day is the point",
    text: "Time is the scarce good. A shorter week gives people room for care, health and civic life, and the gains are largest for workers who currently absorb burnout silently.",
    stance: "pro",
    speaker: "advocate",
    tags: ["wellbeing", "equity"],
    group: "For the motion",
    premises: [
      "Burnout and chronic overwork impose large health and social costs.",
      "Unpaid care work falls disproportionately on women and expands to fill available time.",
      "A guaranteed extra day distributes time more equally than wage gains alone."
    ],
    conclusion: "A four-day week improves welfare in a way that GDP does not measure."
  },
  {
    id: "pro-climate",
    kind: "argument",
    title: "One fewer commute day cuts emissions and congestion",
    text: "Commuting is a large share of weekly travel. Removing one day of peak travel per worker reduces emissions, road wear and the peak capacity that cities must build for.",
    stance: "pro",
    speaker: "advocate",
    tags: ["climate", "mobility"],
    group: "For the motion",
    premises: [
      "Peak commuting is a major source of urban transport emissions.",
      "A four-day week removes roughly a fifth of commute trips for affected workers.",
      "Lower peak demand reduces the need for expensive road and transit capacity."
    ],
    conclusion: "A shorter week is a low-cost climate measure with immediate effects."
  },
  {
    id: "con-cost",
    kind: "argument",
    title: "The costs fall on firms that cannot compress",
    text: "A hospital ward, a restaurant or a bus depot cannot deliver the same coverage in four days. Either they hire more staff, raise prices, or leave the service understaffed.",
    stance: "con",
    speaker: "challenger",
    tags: ["implementation", "economics"],
    group: "Against the motion",
    premises: [
      "Many services require continuous coverage rather than project work.",
      "Compressing hours means hiring more people or paying overtime.",
      "Small firms with thin margins cannot absorb a 20% increase in labour cost."
    ],
    conclusion: "A universal four-day mandate would raise costs and reduce service in labour-intensive sectors."
  },
  {
    id: "con-coverage",
    kind: "argument",
    title: "It would widen the gap between salaried and hourly workers",
    text: "The trial evidence comes mostly from knowledge firms. Warehouse, care and hospitality workers would either be excluded or see their hours cut without the same pay protection.",
    stance: "con",
    speaker: "challenger",
    tags: ["equity", "implementation"],
    group: "Against the motion",
    premises: [
      "Most four-day-week trials involve salaried office workers with measurable output.",
      "Hourly workers are more likely to see hours reduced than pay preserved.",
      "A voluntary default lets the best-off workers capture the benefit first."
    ],
    conclusion: "A universal four-day week could entrench the divide it promises to close."
  },
  {
    id: "con-scheduling",
    kind: "argument",
    title: "Compressed hours can make the working day worse",
    text: "Many firms implement four days by stretching the other four into ten-hour shifts. That can increase fatigue, childcare conflicts and errors, while the total time worked barely changes.",
    stance: "con",
    speaker: "challenger",
    tags: ["wellbeing", "implementation"],
    group: "Against the motion",
    premises: [
      "Compressed schedules often preserve total hours rather than reduce them.",
      "Longer shifts are associated with fatigue, injury and reduced attention.",
      "School and childcare hours do not stretch to match a ten-hour day."
    ],
    conclusion: "A four-day week can redistribute stress rather than remove it."
  },
  {
    id: "pro-rebut-cost",
    kind: "argument",
    title: "Coverage is a scheduling problem, not a four-day problem",
    text: "Hospitals already run shift systems. A shorter normal week can be phased in with staggered rotas, and the firms that cannot adapt can be given longer transition periods.",
    stance: "pro",
    speaker: "advocate",
    tags: ["implementation", "service"],
    group: "Rebuttals",
    premises: [
      "Continuous-coverage workplaces already schedule shifts across seven days.",
      "Staggered four-day rotas can preserve coverage without a 20% headcount increase.",
      "Phased implementation and sectoral bargaining can absorb transition costs."
    ],
    conclusion: "The coverage objection is an argument for careful design, not for the status quo."
  },
  {
    id: "con-rebut-productivity",
    kind: "argument",
    title: "The trials select for firms that can succeed",
    text: "Companies that volunteer for a four-day trial are already well run, office-based and able to measure output. The results tell us about those firms, not about the economy as a whole.",
    stance: "con",
    speaker: "challenger",
    tags: ["evidence", "economics"],
    group: "Rebuttals",
    premises: [
      "Trial participants are self-selected and often knowledge-intensive.",
      "Firms with measurable output can cut meetings more easily than service firms.",
      "Long-run effects may differ from the enthusiasm of a pilot period."
    ],
    conclusion: "The productivity case is weaker than the trial headlines suggest."
  },
  {
    id: "pro-rebut-scheduling",
    kind: "argument",
    title: "The point is fewer hours, not longer days",
    text: "A genuine four-day week reduces total hours; it does not cram five days into four. Firms that simply stretch the day are not implementing the policy being proposed.",
    stance: "pro",
    speaker: "advocate",
    tags: ["wellbeing", "policy"],
    group: "Rebuttals",
    premises: [
      "The proposal is for roughly 32 hours at full pay, not four ten-hour days.",
      "Compressed schedules are a different policy with different effects.",
      "Regulation can define the default in hours, not just days."
    ],
    conclusion: "Criticism of compressed schedules does not touch a genuine shorter-week policy."
  },
  {
    id: "con-rebut-wellbeing",
    kind: "argument",
    title: "Time gains are not evenly distributed",
    text: "A day off is worth little to a worker who uses it for a second job or unpaid care. Without wage and care policy, the extra day can become an accounting trick rather than rest.",
    stance: "con",
    speaker: "challenger",
    tags: ["equity", "wellbeing"],
    group: "Rebuttals",
    premises: [
      "Low-paid workers often need additional hours to meet basic costs.",
      "Unpaid care responsibilities expand when formal work contracts.",
      "The wellbeing benefit depends on income security and public care provision."
    ],
    conclusion: "A four-day week without wage and care reform may not deliver the promised rest."
  },
  {
    id: "pro-rebut-coverage",
    kind: "argument",
    title: "Public-sector coverage can be planned democratically",
    text: "Schools, hospitals and transport can schedule shorter weeks through public workforce planning. The alternative is to let coverage arguments freeze working time forever.",
    stance: "pro",
    speaker: "advocate",
    tags: ["public-sector", "implementation"],
    group: "Rebuttals",
    premises: [
      "Public employers can plan rotas and hiring across a whole sector.",
      "Collective bargaining can trade schedule changes against pay and staffing.",
      "Coverage is a budget decision, not a fixed constraint of nature."
    ],
    conclusion: "With public planning, shorter weeks and service coverage can coexist."
  }
];

const fourDayEdges: Partial<DebateEdge>[] = [
  { from: "pro-productivity", to: "thesis", type: "support" },
  { from: "pro-wellbeing", to: "thesis", type: "support" },
  { from: "pro-climate", to: "thesis", type: "support" },
  { from: "con-cost", to: "thesis", type: "attack" },
  { from: "con-coverage", to: "thesis", type: "attack" },
  { from: "con-scheduling", to: "thesis", type: "attack" },
  { from: "pro-rebut-cost", to: "con-cost", type: "attack" },
  { from: "pro-rebut-cost", to: "thesis", type: "support" },
  { from: "con-rebut-productivity", to: "pro-productivity", type: "undercut" },
  { from: "pro-rebut-scheduling", to: "con-scheduling", type: "attack" },
  { from: "con-rebut-wellbeing", to: "pro-wellbeing", type: "undercut" },
  { from: "pro-rebut-coverage", to: "con-coverage", type: "attack" }
];

function makeSeedDebate(
  id: string,
  motion: string,
  position: string,
  authorNote: string,
  nodes: SeedNode[],
  edges: Partial<DebateEdge>[]
): Debate {
  const now = Date.now();
  return reconcileDebate({
    id,
    motion,
    thesisId: "thesis",
    thesisText: nodes[0]?.text,
    nodes,
    edges,
    origin: "seed",
    position,
    authorNote,
    chat: [
      message(
        "assistant",
        authorNote,
        "intake"
      )
    ],
    createdAt: now - 1000 * 60 * 60 * 20,
    updatedAt: now - 1000 * 60 * 60 * 20
  });
}

export function seedDebates(): Debate[] {
  return [
    makeSeedDebate(
      "seed-transit",
      "Should cities make public transit free at the point of use?",
      "I think cities should make public transit free at the point of use. Debate me.",
      "I put your claim at the centre and built both wings around it: four affirmative arguments, four objections, then the rebuttals where the real fight is. The sharpest clash is between the equity case for free access and the fiscal case that the poor end up paying for it.",
      transitNodes,
      transitEdges
    ),
    makeSeedDebate(
      "seed-fourday",
      "Should the four-day week become the default full-time schedule?",
      "I think the four-day week should be the default. Debate me.",
      "Mapped the strongest version of the shorter-week case — productivity, time and climate — against the coverage, equity and implementation objections. Notice how often the two sides disagree about what counts as evidence.",
      fourDayNodes,
      fourDayEdges
    )
  ];
}
