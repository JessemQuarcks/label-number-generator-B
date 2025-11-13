const Label = ({ number }: { number: number }) => {
  return (
    <div className="m-5 relative border-2 border-black">
      {/* 454px = ~120mm */}
      <img src="dried_orange_peels_conventional.jpg" width={"454"} />
      <p className="absolute bottom-4 right-4 text-sm font-bold">
        {number.toString().padStart(3, "0")}
      </p>
    </div>
  );
};

export default Label;
