// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Deterministic BPMN generation for a bounded composition. The plan is already
// validated and ordered; this only serializes it into Flowable's external-worker
// construct. Step identity comes from the generated element ID and the database
// row, never from caller-supplied XML or extension fields.
export const COMPOSITION_PROCESS_KEY = "rosetta_c4b_composition";
export const COMPOSITION_TOPIC = "rosetta-c4b-step";

export function compositionBpmn(stepIds) {
  if (!Array.isArray(stepIds) || stepIds.length < 1 || stepIds.length > 16 ||
    stepIds.some(id => typeof id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) ||
    new Set(stepIds).size !== stepIds.length) throw new TypeError("invalid composition steps");
  const nodes = [];
  let previous = "start";
  stepIds.forEach((_, index) => {
    const task = `step_${index}`;
    nodes.push(`    <sequenceFlow id="to_${task}" sourceRef="${previous}" targetRef="${task}" />`);
    nodes.push(`    <serviceTask id="${task}" name="Guarded step ${index + 1}"
                 flowable:type="external-worker" flowable:topic="${COMPOSITION_TOPIC}" />`);
    previous = task;
  });
  nodes.push(`    <sequenceFlow id="to_end" sourceRef="${previous}" targetRef="end" />`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:flowable="http://flowable.org/bpmn"
             targetNamespace="urn:rosetta:c4b">
  <process id="${COMPOSITION_PROCESS_KEY}" name="Guarded bounded composition" isExecutable="true">
    <startEvent id="start" />
${nodes.join("\n")}
    <endEvent id="end" />
    <subProcess id="deadline_guard" triggeredByEvent="true">
      <startEvent id="deadline_start" isInterrupting="true">
        <timerEventDefinition><timeDate>\${deadlineAt}</timeDate></timerEventDefinition>
      </startEvent>
      <sequenceFlow id="to_deadline_end" sourceRef="deadline_start" targetRef="deadline_end" />
      <endEvent id="deadline_end"><terminateEventDefinition /></endEvent>
    </subProcess>
  </process>
</definitions>
`;
}
