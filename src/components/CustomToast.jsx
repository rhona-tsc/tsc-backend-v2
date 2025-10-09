import React from "react";
import { FiCheckCircle, FiX, FiAlertTriangle, FiInfo } from "react-icons/fi";
const iconMap = {
  success: <FiCheckCircle className="text-[#ff6667]" size={20} />,
  error: <FiX className="text-white" size={20} />,
  warning: <FiAlertTriangle className="text-white" size={20} />,
  info: <FiInfo className="text-white" size={20} />,
};

const CustomToast = ({ type = "info", message }) => {
  return (
    <div className="flex items-center gap-3 bg-black text-white px-4 py-3 border-l-4 border-[#ff6667]  w-full text-sm">
      <div>{iconMap[type]}</div>
      <div className="flex-1">{message}</div>
      <button
        className="text-white font-bold text-sm"
        onClick={(e) => {
          e.currentTarget.closest(".Toastify__toast")?.remove();
        }}
      >
        ×
      </button>
    </div>
  );
};

export default CustomToast;