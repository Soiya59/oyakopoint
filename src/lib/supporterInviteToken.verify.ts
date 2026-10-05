import { extractSupporterInviteToken } from "./supporterInviteToken";

const T = "b22845f7-675b-428a-be90-3c847c2ab9e9";
const cases: [string, string | null][] = [
  [T, T],
  [`  ${T}  `, T],
  [T.toUpperCase(), T],
  [`oyakopoint://onboarding/join-supporter?token=${T}`, T],
  [`https://soiyalab.com/oyakopoint/onboarding/join-supporter?token=${T}`, T],
  ["招待コード: " + T + " です", T],
  ["", null],
  ["AB3CD9EF", null],
  ["b22845f7-675b-428a-be90", null],
];
let ng = 0;
for (const [input, want] of cases) {
  const got = extractSupporterInviteToken(input);
  if (got !== want) { ng++; console.log("NG", JSON.stringify(input), "→", got, "期待", want); }
}
console.log(ng === 0 ? `全部OK（${cases.length}件）` : `NG ${ng}件`);
if (ng) process.exit(1);
