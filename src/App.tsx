import { Label } from "./components";

function App() {
  return (
    <div>
      {Array(1000)
        .fill(0)
        .map((_, idx) => (
          <Label key={idx} number={idx + 1} />
        ))}
    </div>
  );
}

export default App;
