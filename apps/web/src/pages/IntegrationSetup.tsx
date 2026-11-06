import { useNavigate } from "react-router-dom";
import { IntegrationSetup } from "../components/integrations/IntegrationSetup";

export function IntegrationSetupPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-full bg-background px-6 py-12">
      <div className="mx-auto max-w-[560px]">
        <IntegrationSetup onDone={() => navigate("/app")} />
      </div>
    </div>
  );
}
