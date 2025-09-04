import { Label } from "./components";

function App() {
  return (
    <div>
      {Array(50)
        .fill(0)
        .map((_, idx) => (
          <Label key={idx} number={idx + 851} />
        ))}
    </div>
  );
}

export default App;
