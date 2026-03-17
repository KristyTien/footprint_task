import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import WorkflowControlPanel from "./components/WorkflowControlPanel";
import VisPanel from "./components/VisPanel";
import UserActionPanel from "./components/UserActionPanel";

export default function App() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);

  return (
    <div className="flex flex-row h-screen w-screen overflow-hidden bg-slate-100">
      <WorkflowControlPanel
        selectedExecutionId={activeExecutionId}
        onSelectWorkflow={(workflowId) => {
          setSelectedWorkflowId(workflowId);
          setActiveExecutionId(null);
        }}
        onSelectExecution={(workflowId, executionId) => {
          setSelectedWorkflowId(workflowId);
          setActiveExecutionId(executionId);
        }}
      />
      <ReactFlowProvider>
        <VisPanel selectedId={selectedWorkflowId} executionId={activeExecutionId} />
      </ReactFlowProvider>
      <UserActionPanel executionId={activeExecutionId} />
    </div>
  );
}
