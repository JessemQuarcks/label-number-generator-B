const Label = ({ number }: { number: number }) => {
  return (
    <div className="m-5 relative border-2 border-black">
      <img src="dried_orange_peels_organic.jpg" />
      <p className="absolute bottom-12 right-14 text-3xl font-bold">
        {number.toString().padStart(3, "0")}
      </p>
    </div>
  );
};

export default Label;
