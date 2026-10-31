/**
 * Experiment 7 (DA-9): how the gas of ConsentManager.checkAndLogAccess grows
 * with the number of consents a patient already holds. isConsentValid scans
 * the patient's consent list linearly, so the position of the matching
 * consent (first / last / none) matters.
 *
 * For each k, a fresh patient grants k consents to a filler provider
 * (never the checking provider), then the checking provider (doctor1)
 * calls checkAndLogAccess in three situations:
 *   first : doctor1's consent was granted BEFORE the k filler consents -> match at index 0
 *   last  : doctor1's consent was granted AFTER the k filler consents  -> match at index k
 *   none  : doctor1 has no consent                                     -> full scan, denied
 *
 * Requires: hardhat node running + `npm run seed:local` done.
 * Output: experiments/results/consent-scaling.csv
 */
const { ethers } = require("ethers");
const { connect } = require("./lib/chain");
const { writeCsv } = require("./lib/csv");

const KS = (process.env.KS || "0,1,5,10,25,50,100").split(",").map(Number);
const BASE_INDEX = 3000;

async function fund(admin, w) {
  await (await admin.sendTransaction({ to: w.address, value: ethers.parseEther("1.0") })).wait();
}

async function main() {
  const { contracts, wallet } = connect();
  const admin = wallet(0);
  const doctor = wallet(3); // registered provider from seed-demo.js
  const filler = wallet(BASE_INDEX);
  await fund(admin, filler);
  await (await contracts.registry.connect(admin).registerProvider(filler.address, "Filler", "General", "Bench", false)).wait();

  const rows = [];
  let cursor = BASE_INDEX + 1;
  const now = Math.floor(Date.now() / 1000);
  const recordId = ethers.hexlify(ethers.randomBytes(32));

  for (const k of KS) {
    for (const scenario of ["first", "last", "none"]) {
      const patient = wallet(cursor++);
      await fund(admin, patient);
      await (await contracts.registry.connect(admin).registerPatient(patient.address, "cid://scaling")).wait();
      const cm = contracts.consentManager.connect(patient);
      const grant = (provider) => cm.grantConsent(provider, ethers.ZeroHash, "treatment", now - 60, now + 86400);
      if (scenario === "first") await (await grant(doctor.address)).wait();
      for (let i = 0; i < k; i++) await (await grant(filler.address)).wait();
      if (scenario === "last") await (await grant(doctor.address)).wait();

      const tx = await contracts.consentManager.connect(doctor).checkAndLogAccess(patient.address, recordId, "treatment");
      const receipt = await tx.wait();
      rows.push({ fillerConsents: k, scenario, gasUsed: Number(receipt.gasUsed) });
      console.log(k, scenario, Number(receipt.gasUsed));
    }
  }
  writeCsv("consent-scaling.csv", ["fillerConsents", "scenario", "gasUsed"], rows);
}

main().catch((e) => { console.error(e); process.exit(1); });
