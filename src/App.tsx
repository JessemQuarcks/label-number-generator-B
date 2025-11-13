import { Label } from "./components";

function App() {
  return (
    <div className="flex gap-4 flex-wrap">
      {Array(1000)
        .fill(0)
        .map((_, idx) => (
          <Label key={idx} number={idx + 1} />
        ))}
    </div>
  );
}

export default App;
