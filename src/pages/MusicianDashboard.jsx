import React from 'react'

const MusicianDashboard = () => {
  return (
    <div>
      <div className="p-6 bg-white shadow rounded-lg">
  <h2 className="text-xl font-bold mb-4">Your Saved Drafts</h2>
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {drafts.map((draft) => (
      <div key={draft._id} className="border p-4 rounded hover:shadow-lg transition">
        <h3 className="font-semibold text-lg">{draft.name || "Untitled Act"}</h3>
        <p className="text-sm text-gray-500 mt-1">Saved: {new Date(draft.updatedAt).toLocaleDateString()}</p>
        <div className="flex justify-between items-center mt-4">
          <button
            onClick={() => navigate(`/edit/${draft._id}`)}
            className="px-4 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Continue Editing
          </button>
          <button
            onClick={() => handleDelete(draft._id)}
            className="text-sm text-red-500 hover:underline"
          >
            Delete
          </button>
        </div>
      </div>
    ))}
  </div>
</div>
    </div>
  )
}

export default MusicianDashboard
